using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;
using MockPaymentsApi.Domain.Entities;
using MockPaymentsApi.Domain.Repositories;

namespace MockPaymentsApi.Infrastructure.Persistence;

public class InMemoryLedgerRepository : ILedgerRepository
{
    private readonly ConcurrentDictionary<string, List<LedgerEntry>> _ledger = new();
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _locks = new();
    private readonly ILogger<InMemoryLedgerRepository> _logger;

    public InMemoryLedgerRepository(ILogger<InMemoryLedgerRepository> logger)
        => _logger = logger;

    public async Task<bool> TryWriteAsync(string paymentId, IEnumerable<LedgerEntry> entries)
    {
        var sem = _locks.GetOrAdd(paymentId, _ => new SemaphoreSlim(1, 1));
        await sem.WaitAsync();
        try
        {
            if (_ledger.ContainsKey(paymentId))
            {
                _logger.LogWarning("ledger_duplicate_skipped payment_id={PaymentId}", paymentId);
                return false;
            }

            _ledger[paymentId] = entries.ToList();
            _logger.LogInformation("ledger_written payment_id={PaymentId}", paymentId);
            return true;
        }
        finally
        {
            sem.Release();
        }
    }

    public IReadOnlyList<LedgerEntry>? GetByPaymentId(string paymentId)
    {
        _ledger.TryGetValue(paymentId, out var entries);
        return entries?.AsReadOnly();
    }
}
