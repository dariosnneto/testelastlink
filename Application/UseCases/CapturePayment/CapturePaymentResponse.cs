using MockPaymentsApi.Domain.Entities;

namespace MockPaymentsApi.Application.UseCases.CapturePayment;

public class CapturePaymentResponse
{
    public bool IsSuccess { get; private init; }
    public bool IsNotFound { get; private init; }
    public bool IsUnprocessable { get; private init; }
    public Payment? Payment { get; private init; }
    public string? Error { get; private init; }

    public static CapturePaymentResponse Success(Payment p) => new() { IsSuccess = true, Payment = p };
    public static CapturePaymentResponse NotFound() => new() { IsNotFound = true, Error = "Payment not found." };
    public static CapturePaymentResponse Unprocessable(string e) => new() { IsUnprocessable = true, Error = e };
}
