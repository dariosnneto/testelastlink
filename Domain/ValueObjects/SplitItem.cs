namespace MockPaymentsApi.Domain.ValueObjects;

public sealed record SplitItem
{
    public string Recipient { get; }
    public int Percentage { get; }

    public SplitItem(string recipient, int percentage)
    {
        if (string.IsNullOrWhiteSpace(recipient)) throw new ArgumentException("Recipient is required.");
        if (percentage <= 0 || percentage > 100) throw new ArgumentException("Percentage must be between 1 and 100.");
        Recipient = recipient;
        Percentage = percentage;
    }

    public long CalculateAmount(long total) => (long)Math.Round(total * Percentage / 100.0);
}
