namespace MockPaymentsApi.Application.Ports;

public interface IIdempotencyStore
{
    bool TryGet(string key, out (string Hash, string PaymentId) value);

    /// <summary>
    /// Atomically sets the key if absent. Returns the record that "won" —
    /// either the one just inserted (PaymentId == paymentId) or a previously
    /// registered one from a concurrent request.
    /// </summary>
    (string Hash, string PaymentId) SetIfAbsent(string key, string hash, string paymentId);
}
