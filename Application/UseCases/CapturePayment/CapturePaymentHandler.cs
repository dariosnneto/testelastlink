using Microsoft.Extensions.Logging;
using MockPaymentsApi.Application.Ports;
using MockPaymentsApi.Domain.Entities;
using MockPaymentsApi.Domain.Repositories;

namespace MockPaymentsApi.Application.UseCases.CapturePayment;

public class CapturePaymentHandler
{
    private readonly IPaymentRepository _paymentRepository;
    private readonly ILedgerRepository _ledgerRepository;
    private readonly IWebhookPort _webhookPort;
    private readonly ILogger<CapturePaymentHandler> _logger;

    public CapturePaymentHandler(
        IPaymentRepository paymentRepository,
        ILedgerRepository ledgerRepository,
        IWebhookPort webhookPort,
        ILogger<CapturePaymentHandler> logger)
    {
        _paymentRepository = paymentRepository;
        _ledgerRepository = ledgerRepository;
        _webhookPort = webhookPort;
        _logger = logger;
    }

    public async Task<CapturePaymentResponse> HandleAsync(CapturePaymentCommand command)
    {
        var payment = _paymentRepository.GetById(command.PaymentId);
        if (payment is null)
            return CapturePaymentResponse.NotFound();

        var result = payment.Capture();
        if (!result.IsSuccess)
            return CapturePaymentResponse.Unprocessable(result.Error!);

        _logger.LogInformation("payment_captured payment_id={PaymentId}", payment.Id);

        var entries = BuildLedgerEntries(payment);
        await _ledgerRepository.TryWriteAsync(payment.Id, entries);

        await _webhookPort.SendAsync(payment);
        payment.ClearDomainEvents();

        return CapturePaymentResponse.Success(payment);
    }

    private static List<LedgerEntry> BuildLedgerEntries(Payment payment)
    {
        var entries = new List<LedgerEntry>
        {
            new("debit", "customer", payment.Amount.Value)
        };

        foreach (var split in payment.Split)
            entries.Add(new LedgerEntry("credit", split.Recipient, split.CalculateAmount(payment.Amount.Value)));

        return entries;
    }
}
