using Microsoft.Extensions.Logging;
using MockPaymentsApi.Domain.Repositories;

namespace MockPaymentsApi.Application.UseCases.RejectPayment;

public class RejectPaymentHandler
{
    private readonly IPaymentRepository _paymentRepository;
    private readonly ILogger<RejectPaymentHandler> _logger;

    public RejectPaymentHandler(IPaymentRepository paymentRepository, ILogger<RejectPaymentHandler> logger)
    {
        _paymentRepository = paymentRepository;
        _logger = logger;
    }

    public RejectPaymentResponse Handle(RejectPaymentCommand command)
    {
        var payment = _paymentRepository.GetById(command.PaymentId);
        if (payment is null)
            return RejectPaymentResponse.NotFound();

        var result = payment.Reject();
        if (!result.IsSuccess)
            return RejectPaymentResponse.Unprocessable(result.Error!);

        _logger.LogInformation("payment_rejected payment_id={PaymentId}", payment.Id);
        return RejectPaymentResponse.Success(payment);
    }
}