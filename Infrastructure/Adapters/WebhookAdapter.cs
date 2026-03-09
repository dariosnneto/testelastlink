using MockPaymentsApi.Application.Ports;
using MockPaymentsApi.Domain.Entities;

namespace MockPaymentsApi.Infrastructure.Adapters;

public class WebhookAdapter : IWebhookPort
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<WebhookAdapter> _logger;
    private readonly string _webhookUrl;

    private static readonly int[] RetryDelaysSeconds = { 1, 3, 5 };

    public WebhookAdapter(IHttpClientFactory httpClientFactory, ILogger<WebhookAdapter> logger, IConfiguration config)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
        _webhookUrl = config.GetValue<string>("Webhook:Url") ?? "http://localhost:4000/webhook";
    }

    public Task SendAsync(Payment payment)
    {
        // Fire-and-forget — does not block the capture response
        _ = Task.Run(() => SendWithRetryAsync(payment));
        return Task.CompletedTask;
    }

    private async Task SendWithRetryAsync(Payment payment)
    {
        var payload = new
        {
            @event = "payment.approved",
            payment_id = payment.Id,
            amount = payment.Amount.Value
        };

        var client = _httpClientFactory.CreateClient("webhook");

        for (int attempt = 0; attempt <= RetryDelaysSeconds.Length; attempt++)
        {
            try
            {
                var response = await client.PostAsJsonAsync(_webhookUrl, payload);

                if (response.IsSuccessStatusCode)
                {
                    _logger.LogInformation("webhook_success payment_id={PaymentId} attempt={Attempt}",
                        payment.Id, attempt + 1);
                    return;
                }

                _logger.LogWarning("webhook_retry payment_id={PaymentId} attempt={Attempt} status={Status}",
                    payment.Id, attempt + 1, (int)response.StatusCode);
            }
            catch (Exception ex)
            {
                _logger.LogWarning("webhook_retry payment_id={PaymentId} attempt={Attempt} error={Error}",
                    payment.Id, attempt + 1, ex.Message);
            }

            if (attempt < RetryDelaysSeconds.Length)
                await Task.Delay(TimeSpan.FromSeconds(RetryDelaysSeconds[attempt]));
        }

        _logger.LogError("webhook_failed payment_id={PaymentId} max_retries_exceeded", payment.Id);
    }
}
