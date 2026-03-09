using MockPaymentsApi.Domain.Entities;

namespace MockPaymentsApi.Domain.Repositories;

public interface ILedgerRepository
{
    Task<bool> TryWriteAsync(string paymentId, IEnumerable<LedgerEntry> entries);
    IReadOnlyList<LedgerEntry>? GetByPaymentId(string paymentId);
}
