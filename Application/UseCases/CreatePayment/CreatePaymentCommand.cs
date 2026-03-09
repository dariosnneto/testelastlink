namespace MockPaymentsApi.Application.UseCases.CreatePayment;

public record CreatePaymentCommand(
    string? IdempotencyKey,
    long Amount,
    string Currency,
    string CustomerId,
    string MerchantId,
    IEnumerable<(string Recipient, int Percentage)> Split);
