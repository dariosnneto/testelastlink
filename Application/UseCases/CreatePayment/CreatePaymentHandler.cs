using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using MockPaymentsApi.Application.Ports;
using MockPaymentsApi.Domain.Entities;
using MockPaymentsApi.Domain.Repositories;
using MockPaymentsApi.Domain.ValueObjects;

namespace MockPaymentsApi.Application.UseCases.CreatePayment;

public class CreatePaymentHandler
{
    private readonly IPaymentRepository _paymentRepository;
    private readonly IIdempotencyStore _idempotencyStore;
    private readonly ILogger<CreatePaymentHandler> _logger;

    public CreatePaymentHandler(
        IPaymentRepository paymentRepository,
        IIdempotencyStore idempotencyStore,
        ILogger<CreatePaymentHandler> logger)
    {
        _paymentRepository = paymentRepository;
        _idempotencyStore = idempotencyStore;
        _logger = logger;
    }

    public CreatePaymentResponse Handle(CreatePaymentCommand command)
    {
        var payloadHash = ComputeHash(command);

        if (command.IdempotencyKey is not null)
        {
            if (_idempotencyStore.TryGet(command.IdempotencyKey, out var existing))
            {
                if (existing.Hash != payloadHash)
                    return CreatePaymentResponse.Conflict("Idempotency key already used with a different payload.");

                var cached = _paymentRepository.GetById(existing.PaymentId);
                return CreatePaymentResponse.Success(cached!);
            }
        }

        Money money;
        try { money = new Money(command.Amount, command.Currency.ToUpperInvariant()); }
        catch (ArgumentException ex) { return CreatePaymentResponse.ValidationError(ex.Message); }

        List<SplitItem> splits;
        try { splits = command.Split.Select(s => new SplitItem(s.Recipient, s.Percentage)).ToList(); }
        catch (ArgumentException ex) { return CreatePaymentResponse.ValidationError(ex.Message); }

        if (splits.Sum(s => s.Percentage) != 100)
            return CreatePaymentResponse.ValidationError("Split percentages must sum to 100.");

        var payment = Payment.Create(command.CustomerId, command.MerchantId, money, splits);
        _paymentRepository.Add(payment);

        if (command.IdempotencyKey is not null)
        {
            var winner = _idempotencyStore.SetIfAbsent(command.IdempotencyKey, payloadHash, payment.Id);
            if (winner.PaymentId != payment.Id)
            {
                // Lost the race — another concurrent request registered this key first.
                if (winner.Hash != payloadHash)
                    return CreatePaymentResponse.Conflict("Idempotency key already used with a different payload.");
                return CreatePaymentResponse.Success(_paymentRepository.GetById(winner.PaymentId)!);
            }
        }

        _logger.LogInformation("payment_created payment_id={PaymentId} amount={Amount} currency={Currency}",
            payment.Id, payment.Amount.Value, payment.Amount.Currency);

        return CreatePaymentResponse.Success(payment);
    }

    private static string ComputeHash(CreatePaymentCommand command)
    {
        var data = new { command.Amount, command.Currency, command.CustomerId, command.MerchantId,
            Split = command.Split.Select(s => new { s.Recipient, s.Percentage }) };
        var json = JsonSerializer.Serialize(data);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json)));
    }
}
