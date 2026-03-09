namespace MockPaymentsApi.Application.Ports;

public interface IIdempotencyStore
{
    bool TryGet(string key, out (string Hash, string PaymentId) value);
    void Set(string key, string hash, string paymentId);
}
