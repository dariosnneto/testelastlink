namespace MockPaymentsApi.Domain.Events;

public abstract record DomainEvent(DateTime OccurredAt)
{
    protected DomainEvent() : this(DateTime.UtcNow) { }
}
