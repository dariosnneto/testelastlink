namespace MockPaymentsApi.Domain.ValueObjects;

public sealed record Money
{
    public long Value { get; }
    public string Currency { get; }

    public Money(long value, string currency)
    {
        if (value <= 0) throw new ArgumentException("Amount must be greater than 0.");
        if (currency != "BRL") throw new ArgumentException("Currency must be BRL.");
        Value = value;
        Currency = currency;
    }
}
