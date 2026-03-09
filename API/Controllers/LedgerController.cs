using Microsoft.AspNetCore.Mvc;
using MockPaymentsApi.Application.UseCases.GetLedger;

namespace MockPaymentsApi.API.Controllers;

[ApiController]
[Route("ledger")]
public class LedgerController : ControllerBase
{
    private readonly GetLedgerHandler _handler;

    public LedgerController(GetLedgerHandler handler) => _handler = handler;

    // GET /ledger/{payment_id}
    [HttpGet("{paymentId}")]
    public IActionResult Get(string paymentId)
    {
        var entries = _handler.Handle(new GetLedgerQuery(paymentId));
        if (entries is null) return NotFound(new { error = "No ledger entries found for this payment." });

        return Ok(new
        {
            payment_id = paymentId,
            entries = entries.Select(e => new { type = e.Type, account = e.Account, amount = e.Amount })
        });
    }
}
