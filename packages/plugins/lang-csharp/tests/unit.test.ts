import { Database } from "bun:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { createPluginHost, discoverRepo, runGenerateRepoSpec } from "@repospec/core";
import { analyzeRepoFlowsWithPlugins } from "@repospec/flows";
import { analyzeRepoPerformance } from "@repospec/perf";
import { langCsharpPlugin } from "@repospec/plugin-lang-csharp";

function makeTempCsRepo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repospec-cs-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return dir;
}

describe("@repospec/plugin-lang-csharp unit invariants (R2)", () => {
  test("defines valid dogfooded plugin and activates cleanly into extractor domain", async () => {
    expect(langCsharpPlugin.id).toBe("repospec.lang.csharp");
    const host = await createPluginHost({ includeBuiltins: false, plugins: [langCsharpPlugin] });
    try {
      const entries = host.list();
      expect(entries.length).toBe(1);
      expect(entries[0]?.id).toBe("repospec.lang.csharp");
      expect(entries[0]?.status).toBe("active");
      expect(host.domains.extractor.get().length >= 1).toBe(true);
    } finally {
      await host.dispose();
    }
  });

  test("extracts global usings, ASP.NET routes, EF/Dapper accesses, migrations, appsettings, enum state machines, external services, and CI links", async () => {
    const dir = makeTempCsRepo({
      "Acme.slnx": `<Solution><Project Path="Acme.Api/Acme.Api.csproj" /><Project Path="Acme.Tests/Acme.Tests.csproj" /></Solution>`,
      ".github/workflows/ci.yml": `
name: CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: dotnet build
      - run: dotnet test
`,
      "Acme.Api/Acme.Api.csproj": `
<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFrameworks>net9.0;net8.0</TargetFrameworks>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>
  <ItemGroup>
    <Using Include="Acme.Api.Domain" />
    <PackageReference Include="Stripe.net" Version="47.0.0" />
    <PackageReference Include="MassTransit" Version="8.3.0" />
    <PackageReference Include="Dapper" Version="2.1.0" />
  </ItemGroup>
</Project>
`,
      "Acme.Api/appsettings.json": JSON.stringify({
        ConnectionStrings: { Default: "Host=localhost;Database=acme" },
        Billing: { ApiKey: "" },
      }),
      "Acme.Api/GlobalUsings.cs": `global using Acme.Api.Data;\nglobal using Acme.Api.Services;\n`,
      "Acme.Api/Program.cs": `
var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();
var v1 = app.MapGroup("/api/v1").RequireAuthorization();
v1.MapGet("/health", () => Results.Ok()).AllowAnonymous();
v1.MapPost("/invoices", async (InvoiceService svc) =>
{
    var a = await svc.GetAccountAsync("1");
    var b = await svc.GetRatesAsync("USD");
    return Results.Ok(new { a, b });
});
app.MapHub<OrderHub>("/hubs/orders");
app.Run();
`,
      "Acme.Api/Domain/InvoiceStatus.cs": `
namespace Acme.Api.Domain;
public enum InvoiceStatus { Draft, Issued, Paid, Voided }
public readonly record struct Money(decimal Amount, string Currency);
public record InvoiceDto(string Id, decimal Amount, string Currency, string CustomerId, string Status);
`,
      "Acme.Api/Data/AppDbContext.cs": `
namespace Acme.Api.Data;
public class AppDbContext : DbContext
{
    public DbSet<Invoice> Invoices => Set<Invoice>();
}
`,
      "Acme.Api/Data/Migrations/20260101_Init.cs": `
namespace Acme.Api.Data.Migrations;
public class Init
{
    public void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(name: "Invoices");
        migrationBuilder.AddForeignKey(table: "Invoices", column: "CustomerId", principalTable: "Customers", principalColumn: "Id");
    }
}
`,
      "Acme.Api/Services/InvoiceService.cs": `
namespace Acme.Api.Services;
public class InvoiceService(AppDbContext _db, IConfiguration _config, HttpClient _http)
{
    public async ValueTask<ActionResult<List<InvoiceDto>>> ProcessAsync([FromQuery(Name = "id")] string id, CancellationToken ct = default(CancellationToken))
    {
        var conn = _config.GetConnectionString("Default");
        var key = _config.GetValue<string>("Billing:ApiKey");
        var inv = await _db.Invoices.FirstOrDefaultAsync(x => x.Id == id, ct);
        var ext = await _http.GetFromJsonAsync<string>($"https://api.billing-partner.example/v1/{inv.CustomerId}", ct);
        return Ok(ext);
    }

    public async Task<string> ParallelizableAsync(string id)
    {
        var a = await GetAccountAsync(id);
        var b = await GetRatesAsync("USD");
        return a + b;
    }

    public InvoiceStatus Transition(InvoiceStatus cur)
    {
        switch (cur)
        {
            case InvoiceStatus.Draft:
                return InvoiceStatus.Issued;
            case InvoiceStatus.Issued:
                return InvoiceStatus.Paid;
            default:
                return cur;
        }
    }

    public Task<int> RunSqlAsync(IDbConnection conn) => conn.QueryAsync<int>("SELECT * FROM AuditLogs WHERE Id = 1");
    public Task<string> GetAccountAsync(string id) => Task.FromResult(id);
    public Task<string> GetRatesAsync(string ccy) => Task.FromResult(ccy);
}
`,
      "Acme.Api/Controllers/InvoicesController.cs": `
namespace Acme.Api.Controllers;
[ApiController]
[Authorize]
[Route("api/[controller]")]
public class InvoicesController(InvoiceService _svc) : ControllerBase
{
    [HttpGet("{id}")]
    public Task<ActionResult<List<InvoiceDto>>> GetById(string id) => _svc.ProcessAsync(id);

    [HttpGet("public-status")]
    [AllowAnonymous]
    public IActionResult Status() => Ok();
}
`,
      "Acme.Tests/Acme.Tests.csproj": `
<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="xunit" Version="2.9.0" />
    <ProjectReference Include="../Acme.Api/Acme.Api.csproj" />
  </ItemGroup>
</Project>
`,
      "Acme.Tests/InvoiceIntegrationTests.cs": `
using Acme.Api.Services;
public class InvoiceIntegrationTests
{
    [Fact]
    public void UsesFactory() { var _ = typeof(WebApplicationFactory<Program>); var s = typeof(InvoiceService); }
}
`,
    });

    try {
      const ctx = discoverRepo(dir, "artifact");
      const apiUnit = ctx.units.find((u) => u.name === "Acme.Api");
      expect(apiUnit?.targetFramework).toBe("net9.0");
      expect(apiUnit?.entryFile).toBe("Acme.Api/Program.cs");
      expect(apiUnit?.layerPolicy).toBe("layered_backend");

      const run = await runGenerateRepoSpec(dir, "artifact");
      const { spec } = run;
      const db = new Database(run.dbPath, { readonly: true });
      try {
        expect(spec.repo.ecosystem).toBe("csharp");

        const imports = db.query("SELECT from_file, to_file FROM file_imports").all() as Array<{ from_file: string; to_file: string }>;
        expect(imports.some((i) => i.from_file.endsWith("InvoicesController.cs") && i.to_file.endsWith("InvoiceService.cs"))).toBe(true);
        expect(imports.some((i) => i.from_file.endsWith("InvoiceService.cs") && i.to_file.endsWith("AppDbContext.cs"))).toBe(true);
        expect(spec.edges.some((e) => e.kind === "imports_layer")).toBe(true);

        const endpoints = db.query("SELECT method, path, auth_guard FROM http_endpoints").all() as Array<{ method: string; path: string; auth_guard: string | null }>;
        expect(endpoints.find((ep) => ep.path === "/api/invoices/{id}" && ep.method === "GET")?.auth_guard).toBe("Authorize");
        expect(endpoints.find((ep) => ep.path === "/api/invoices/public-status" && ep.method === "GET")?.auth_guard).toBe("public");
        expect(endpoints.find((ep) => ep.path === "/api/v1/health" && ep.method === "GET")?.auth_guard).toBe("public");
        expect(endpoints.find((ep) => ep.path === "/api/v1/invoices" && ep.method === "POST")?.auth_guard).toBe("RequireAuthorization");
        expect(endpoints.some((ep) => ep.method === "WS" && ep.path === "/hubs/orders")).toBe(true);

        const accesses = db.query("SELECT file, entity, op, datastore FROM entity_access").all() as Array<{ file: string; entity: string; op: string; datastore: string }>;
        expect(accesses.some((a) => a.file.endsWith("InvoiceService.cs") && a.entity === "Invoices" && a.op === "READ")).toBe(true);
        expect(accesses.some((a) => a.file.endsWith("InvoiceService.cs") && a.entity === "AuditLogs" && a.datastore === "sql")).toBe(true);

        const fks = db.query("SELECT from_table, to_table FROM db_foreign_keys").all() as Array<{ from_table: string; to_table: string }>;
        expect(fks.some((fk) => fk.from_table === "Invoices" && fk.to_table === "Customers")).toBe(true);
        expect(spec.edges.some((e) => e.kind === "reads_writes" && e.to === "arch:datastore:efcore")).toBe(true);

        expect(spec.nodes.some((n) => n.kind === "external_service" && /stripe/i.test(n.label))).toBe(true);
        expect(spec.edges.some((e) => e.kind === "calls_external")).toBe(true);
        const hosts = db.query("SELECT host FROM external_hosts").all() as Array<{ host: string }>;
        expect(hosts.some((h) => h.host === "api.billing-partner.example")).toBe(true);

        const envs = db.query("SELECT env_name, source_kind FROM env_bindings").all() as Array<{ env_name: string; source_kind: string }>;
        expect(envs.some((e) => e.env_name === "ConnectionStrings:Default" && e.source_kind === "code_read")).toBe(true);
        expect(envs.some((e) => e.env_name === "ConnectionStrings:Default" && e.source_kind === "env_example")).toBe(true);
        expect(envs.some((e) => e.env_name === "Billing:ApiKey" && e.source_kind === "code_read")).toBe(true);

        expect(spec.stateMachines.some((sm) => sm.name === "InvoiceStatus" && sm.transitions.length >= 2)).toBe(true);
        const stateEnums = db.query("SELECT name FROM state_enums").all() as Array<{ name: string }>;
        expect(stateEnums.some((se) => se.name === "InvoiceStatus")).toBe(true);

        expect(spec.edges.some((e) => e.from.startsWith("ci:wf:") && e.to === "arch:app:Acme.Api" && e.kind === "verifies")).toBe(true);
        expect(spec.summary.testFilesByRung.R4).toBeGreaterThanOrEqual(1);
      } finally {
        db.close();
      }

      const flowBundle = await analyzeRepoFlowsWithPlugins(dir);
      const processFlow = flowBundle.workFlows.find((f) => f.entryFn === "ProcessAsync");
      expect(processFlow).toBeDefined();
      expect(processFlow?.hazards.some((h) => h.kind === "serial_independent_awaits")).toBe(false);

      const parallelFlow = flowBundle.workFlows.find((f) => f.entryFn === "ParallelizableAsync");
      expect(parallelFlow).toBeDefined();
      expect(parallelFlow?.hazards.some((h) => h.kind === "serial_independent_awaits")).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("polyglot perf scanner detects loops in Allman-formatted C# code", () => {
    const dir = makeTempCsRepo({
      "Services/Matcher.cs": `
public class Matcher
{
    public List<string> FindMatches(List<string> a, List<string> b)
    {
        var outList = new List<string>();
        foreach (var item in a)
        {
            if (b.Contains(item))
            {
                outList.Add(item);
            }
        }
        return outList;
    }
}
`,
    });
    try {
      const res = analyzeRepoPerformance(discoverRepo(dir, "artifact"));
      expect(res.findings.some((f) => f.patternId === "linear-lookup-in-loop")).toBe(true);
      expect(res.profiles.some((p) => p.symbol === "FindMatches" && p.timeComplexity === "O(n^2)")).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
