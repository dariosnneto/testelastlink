using MockPaymentsApi.Domain.Entities;
using MockPaymentsApi.Domain.Repositories;

namespace MockPaymentsApi.Application.UseCases.GetLedger;

public class GetLedgerHandler
{
    private readonly ILedgerRepository _ledgerRepository;

    public GetLedgerHandler(ILedgerRepository ledgerRepository)
        => _ledgerRepository = ledgerRepository;

    public IReadOnlyList<LedgerEntry>? Handle(GetLedgerQuery query)
        => _ledgerRepository.GetByPaymentId(query.PaymentId);
}
