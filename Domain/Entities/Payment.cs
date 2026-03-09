using MockPaymentsApi.Domain.Common;
using MockPaymentsApi.Domain.Events;
using MockPaymentsApi.Domain.ValueObjects;

namespace MockPaymentsApi.Domain.Entities;

public class Payment
{
    private readonly List<DomainEvent> _domainEvents = new();

    public string Id { get; private set; } = string.Empty;
    public string Status { get; private set; } = PaymentStatus.Pending;
    public Money Amount { get; private set; } = null!;
    public string CustomerId { get; private set; } = string.Empty;
    public string MerchantId { get; private set; } = string.Empty;
    public IReadOnlyList<SplitItem> Split { get; private set; } = Array.Empty<SplitItem>();
    public DateTime CreatedAt { get; private set; }

    public IReadOnlyList<DomainEvent> DomainEvents => _domainEvents.AsReadOnly();

    private Payment() { }

    public static Payment Create(
        string customerId,
        string merchantId,
        Money amount,
        IEnumerable<SplitItem> split)
    {
        return new Payment
        {
            Id = $"pay_{Guid.NewGuid():N}",
            Status = PaymentStatus.Pending,
            Amount = amount,
            CustomerId = customerId,
            MerchantId = merchantId,
            Split = split.ToList(),
            CreatedAt = DateTime.UtcNow
        };
    }

    public Result Capture()
    {
        if (Status != PaymentStatus.Pending)
            return Result.Failure($"Payment is already {Status}.");

        Status = PaymentStatus.Approved;
        _domainEvents.Add(new PaymentCapturedEvent(Id, Amount.Value));
        return Result.Success();
    }

    public Result Reject()
    {
        if (Status != PaymentStatus.Pending)
            return Result.Failure($"Payment is already {Status}.");

        Status = PaymentStatus.Failed;
        return Result.Success();
    }

    public void ClearDomainEvents() => _domainEvents.Clear();
}

public static class PaymentStatus
{
    public const string Pending = "PENDING";
    public const string Approved = "APPROVED";
    public const string Failed = "FAILED";
}
