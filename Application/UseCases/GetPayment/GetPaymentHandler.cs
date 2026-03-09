using MockPaymentsApi.Domain.Entities;
using MockPaymentsApi.Domain.Repositories;

namespace MockPaymentsApi.Application.UseCases.GetPayment;

public class GetPaymentHandler
{
    private readonly IPaymentRepository _paymentRepository;

    public GetPaymentHandler(IPaymentRepository paymentRepository)
        => _paymentRepository = paymentRepository;

    public Payment? Handle(GetPaymentQuery query) => _paymentRepository.GetById(query.PaymentId);
}
