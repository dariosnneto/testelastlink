namespace MockPaymentsApi.Domain.Events;

public sealed record PaymentCapturedEvent(string PaymentId, long Amount) : DomainEvent;
