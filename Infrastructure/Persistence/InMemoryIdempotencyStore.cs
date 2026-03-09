using System.Collections.Concurrent;
using MockPaymentsApi.Application.Ports;

namespace MockPaymentsApi.Infrastructure.Persistence;

public class InMemoryIdempotencyStore : IIdempotencyStore
{
    private readonly ConcurrentDictionary<string, (string Hash, string PaymentId)> _store = new();

    public bool TryGet(string key, out (string Hash, string PaymentId) value)
        => _store.TryGetValue(key, out value);

    // GetOrAdd is atomic: only one thread will insert; all others receive the existing record.
    public (string Hash, string PaymentId) SetIfAbsent(string key, string hash, string paymentId)
        => _store.GetOrAdd(key, (hash, paymentId));
}
