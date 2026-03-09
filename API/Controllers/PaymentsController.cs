using Microsoft.AspNetCore.Mvc;
using MockPaymentsApi.API.Requests;
using MockPaymentsApi.Application.UseCases.CapturePayment;
using MockPaymentsApi.Application.UseCases.CreatePayment;
using MockPaymentsApi.Application.UseCases.GetPayment;
using MockPaymentsApi.Application.UseCases.RejectPayment;
using MockPaymentsApi.Domain.Entities;

namespace MockPaymentsApi.API.Controllers;

[ApiController]
[Route("payments")]
public class PaymentsController : ControllerBase
{
    private readonly CreatePaymentHandler _createHandler;
    private readonly GetPaymentHandler _getHandler;
    private readonly CapturePaymentHandler _captureHandler;
    private readonly RejectPaymentHandler _rejectHandler;

    public PaymentsController(
        CreatePaymentHandler createHandler,
        GetPaymentHandler getHandler,
        CapturePaymentHandler captureHandler,
        RejectPaymentHandler rejectHandler)
    {
        _createHandler = createHandler;
        _getHandler = getHandler;
        _captureHandler = captureHandler;
        _rejectHandler = rejectHandler;
    }

    // POST /payments
    [HttpPost]
    public IActionResult Create(
        [FromHeader(Name = "Idempotency-Key")] string? idempotencyKey,
        [FromBody] CreatePaymentRequest body)
    {
        var command = new CreatePaymentCommand(
            idempotencyKey,
            body.Amount,
            body.Currency,
            body.CustomerId,
            body.MerchantId,
            body.Split.Select(s => (s.Recipient, s.Percentage)));

        var response = _createHandler.Handle(command);

        if (response.IsValidationError) return BadRequest(new { error = response.Error });
        if (response.IsConflict) return Conflict(new { error = response.Error });

        return StatusCode(201, ToDto(response.Payment!));
    }

    // GET /payments/{payment_id}
    [HttpGet("{paymentId}")]
    public IActionResult Get(string paymentId)
    {
        var payment = _getHandler.Handle(new GetPaymentQuery(paymentId));
        if (payment is null) return NotFound(new { error = "Payment not found." });
        return Ok(ToDto(payment));
    }

    // POST /payments/{payment_id}/capture
    [HttpPost("{paymentId}/capture")]
    public async Task<IActionResult> Capture(string paymentId)
    {
        var response = await _captureHandler.HandleAsync(new CapturePaymentCommand(paymentId));

        if (response.IsNotFound) return NotFound(new { error = response.Error });
        if (response.IsUnprocessable) return UnprocessableEntity(new { error = response.Error });

        return Ok(ToDto(response.Payment!));
    }

    // POST /payments/{payment_id}/reject
    [HttpPost("{paymentId}/reject")]
    public IActionResult Reject(string paymentId)
    {
        var response = _rejectHandler.Handle(new RejectPaymentCommand(paymentId));

        if (response.IsNotFound) return NotFound(new { error = response.Error });
        if (response.IsUnprocessable) return UnprocessableEntity(new { error = response.Error });

        return Ok(ToDto(response.Payment!));
    }

    private static object ToDto(Payment p) => new
    {
        payment_id = p.Id,
        status = p.Status,
        amount = p.Amount.Value,
        currency = p.Amount.Currency,
        customer_id = p.CustomerId,
        merchant_id = p.MerchantId,
        split = p.Split.Select(s => new { recipient = s.Recipient, percentage = s.Percentage }),
        created_at = p.CreatedAt
    };
}
