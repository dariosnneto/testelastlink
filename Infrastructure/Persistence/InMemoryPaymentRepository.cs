using System.Collections.Concurrent;
using MockPaymentsApi.Domain.Entities;
using MockPaymentsApi.Domain.Repositories;

namespace MockPaymentsApi.Infrastructure.Persistence;

public class InMemoryPaymentRepository : IPaymentRepository
{
    private readonly ConcurrentDictionary<string, Payment> _payments = new();

    public void Add(Payment payment) => _payments[payment.Id] = payment;

    public Payment? GetById(string id)
    {
        _payments.TryGetValue(id, out var payment);
        return payment;
    }
}
