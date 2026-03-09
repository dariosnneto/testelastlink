namespace MockPaymentsApi.Domain.Entities;

public sealed record LedgerEntry(string Type, string Account, long Amount);
