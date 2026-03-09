using MockPaymentsApi.Domain.Entities;

namespace MockPaymentsApi.Application.UseCases.RejectPayment;

public class RejectPaymentResponse
{
    public bool IsSuccess { get; private init; }
    public bool IsNotFound { get; private init; }
    public bool IsUnprocessable { get; private init; }
    public Payment? Payment { get; private init; }
    public string? Error { get; private init; }

    public static RejectPaymentResponse Success(Payment p) => new() { IsSuccess = true, Payment = p };
    public static RejectPaymentResponse NotFound() => new() { IsNotFound = true, Error = "Payment not found." };
    public static RejectPaymentResponse Unprocessable(string e) => new() { IsUnprocessable = true, Error = e };
}