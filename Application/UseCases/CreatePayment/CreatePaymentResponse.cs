using MockPaymentsApi.Domain.Entities;

namespace MockPaymentsApi.Application.UseCases.CreatePayment;

public class CreatePaymentResponse
{
    public bool IsSuccess { get; private init; }
    public bool IsConflict { get; private init; }
    public bool IsValidationError { get; private init; }
    public Payment? Payment { get; private init; }
    public string? Error { get; private init; }

    public static CreatePaymentResponse Success(Payment p) => new() { IsSuccess = true, Payment = p };
    public static CreatePaymentResponse Conflict(string e) => new() { IsConflict = true, Error = e };
    public static CreatePaymentResponse ValidationError(string e) => new() { IsValidationError = true, Error = e };
}
