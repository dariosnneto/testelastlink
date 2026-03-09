using MockPaymentsApi.Domain.Entities;

namespace MockPaymentsApi.Domain.Repositories;

public interface IPaymentRepository
{
    void Add(Payment payment);
    Payment? GetById(string id);
}
