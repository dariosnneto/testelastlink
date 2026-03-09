using MockPaymentsApi.Application.Ports;
using MockPaymentsApi.Application.UseCases.CapturePayment;
using MockPaymentsApi.Application.UseCases.CreatePayment;
using MockPaymentsApi.Application.UseCases.GetLedger;
using MockPaymentsApi.Application.UseCases.GetPayment;
using MockPaymentsApi.Application.UseCases.RejectPayment;
using MockPaymentsApi.Domain.Repositories;
using MockPaymentsApi.Infrastructure.Adapters;
using MockPaymentsApi.Infrastructure.Persistence;

var builder = WebApplication.CreateBuilder(args);

// ── Domain ────────────────────────────────────────────────────────────────
builder.Services.AddSingleton<IPaymentRepository, InMemoryPaymentRepository>();
builder.Services.AddSingleton<ILedgerRepository, InMemoryLedgerRepository>();

// ── Application ───────────────────────────────────────────────────────────
builder.Services.AddSingleton<IIdempotencyStore, InMemoryIdempotencyStore>();
builder.Services.AddSingleton<CreatePaymentHandler>();
builder.Services.AddSingleton<CapturePaymentHandler>();
builder.Services.AddSingleton<RejectPaymentHandler>();
builder.Services.AddSingleton<GetPaymentHandler>();
builder.Services.AddSingleton<GetLedgerHandler>();

// ── Infrastructure ────────────────────────────────────────────────────────
builder.Services.AddSingleton<IWebhookPort, WebhookAdapter>();
builder.Services.AddHttpClient("webhook", client =>
{
    client.Timeout = TimeSpan.FromSeconds(5);
});

// ── API ───────────────────────────────────────────────────────────────────
builder.Services.AddControllers();
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
builder.WebHost.UseUrls("http://0.0.0.0:3000");

var app = builder.Build();
app.UseRouting();
app.MapControllers();
app.Run();
