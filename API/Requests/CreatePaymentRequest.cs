using System.Text.Json.Serialization;

namespace MockPaymentsApi.API.Requests;

public class CreatePaymentRequest
{
    [JsonPropertyName("amount")]
    public long Amount { get; set; }

    [JsonPropertyName("currency")]
    public string Currency { get; set; } = string.Empty;

    [JsonPropertyName("customer_id")]
    public string CustomerId { get; set; } = string.Empty;

    [JsonPropertyName("merchant_id")]
    public string MerchantId { get; set; } = string.Empty;

    [JsonPropertyName("split")]
    public List<SplitItemRequest> Split { get; set; } = new();
}

public class SplitItemRequest
{
    [JsonPropertyName("recipient")]
    public string Recipient { get; set; } = string.Empty;

    [JsonPropertyName("percentage")]
    public int Percentage { get; set; }
}
