using MockPaymentsApi.Domain.Entities;

namespace MockPaymentsApi.Application.Ports;

public interface IWebhookPort
{
    Task SendAsync(Payment payment);
}
