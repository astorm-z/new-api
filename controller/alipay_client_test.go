package controller

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"net/url"
	"testing"
)

func TestBuildPagePayParamsPutsCommonParamsInGatewayURL(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 1024)
	if err != nil {
		t.Fatalf("GenerateKey() error = %v", err)
	}
	client := &alipayClient{
		appID:      "2021000123456789",
		privateKey: privateKey,
		publicKey:  &privateKey.PublicKey,
		gatewayURL: "https://openapi.alipay.com/gateway.do",
	}

	gatewayURL, postParams, err := client.BuildPagePayParams(&alipayPagePayArgs{
		OutTradeNo:  "ALI123456",
		Subject:     "account topup",
		TotalAmount: 1.23,
		NotifyURL:   "https://example.com/api/user/alipay/notify",
		ReturnURL:   "https://example.com/api/user/alipay/return",
		Body:        "new-api topup",
	})
	if err != nil {
		t.Fatalf("BuildPagePayParams() error = %v", err)
	}

	parsedURL, err := url.Parse(gatewayURL)
	if err != nil {
		t.Fatalf("Parse(%q) error = %v", gatewayURL, err)
	}
	query := parsedURL.Query()
	for _, key := range []string{"app_id", "charset", "format", "method", "sign", "sign_type", "timestamp", "version", "notify_url", "return_url"} {
		if query.Get(key) == "" {
			t.Fatalf("gateway query missing %q in %q", key, gatewayURL)
		}
	}
	if query.Get("charset") != alipayCharset {
		t.Fatalf("gateway query charset = %q, want %q", query.Get("charset"), alipayCharset)
	}
	if _, ok := postParams["charset"]; ok {
		t.Fatalf("postParams must not contain charset: %#v", postParams)
	}
	if _, ok := postParams["sign"]; ok {
		t.Fatalf("postParams must not contain sign: %#v", postParams)
	}
	if postParams["biz_content"] == "" {
		t.Fatalf("postParams missing biz_content: %#v", postParams)
	}

	allParams := map[string]string{}
	for key, values := range query {
		if len(values) > 0 {
			allParams[key] = values[0]
		}
	}
	for key, value := range postParams {
		allParams[key] = value
	}
	signatureBytes, err := base64.StdEncoding.DecodeString(allParams["sign"])
	if err != nil {
		t.Fatalf("DecodeString(sign) error = %v", err)
	}
	signContent := buildAlipaySignContent(allParams)
	hash := sha256.Sum256([]byte(signContent))
	if err := rsa.VerifyPKCS1v15(client.publicKey, crypto.SHA256, hash[:], signatureBytes); err != nil {
		t.Fatalf("request signature verification error = %v", err)
	}
}

func TestBuildAlipaySignContentIncludesSignType(t *testing.T) {
	params := map[string]string{
		"app_id":      "2021006147633929",
		"biz_content": `{"body":"new-api topup","out_trade_no":"ALIUSR1NOfZTbH21777394692","product_code":"FAST_INSTANT_TRADE_PAY","subject":"账户充值 1","total_amount":"1.00"}`,
		"charset":     "utf-8",
		"format":      "JSON",
		"method":      "alipay.trade.page.pay",
		"notify_url":  "http://localhost:3000/api/user/alipay/notify",
		"return_url":  "http://localhost:3000/api/user/alipay/return",
		"sign":        "ignored",
		"sign_type":   "RSA2",
		"timestamp":   "2026-04-29 00:44:52",
		"version":     "1.0",
	}

	want := `app_id=2021006147633929&biz_content={"body":"new-api topup","out_trade_no":"ALIUSR1NOfZTbH21777394692","product_code":"FAST_INSTANT_TRADE_PAY","subject":"账户充值 1","total_amount":"1.00"}&charset=utf-8&format=JSON&method=alipay.trade.page.pay&notify_url=http://localhost:3000/api/user/alipay/notify&return_url=http://localhost:3000/api/user/alipay/return&sign_type=RSA2&timestamp=2026-04-29 00:44:52&version=1.0`
	if got := buildAlipaySignContent(params); got != want {
		t.Fatalf("buildAlipaySignContent() = %q, want %q", got, want)
	}
}

func TestBuildAlipayVerifySignContentExcludesSignType(t *testing.T) {
	params := map[string]string{
		"app_id":       "2021006147633929",
		"auth_app_id":  "2021006147633929",
		"charset":      "utf-8",
		"method":       "alipay.trade.page.pay.return",
		"out_trade_no": "ALIUSR1NOhTqqU21777398396",
		"seller_id":    "2088480800445650",
		"sign":         "ignored",
		"sign_type":    "RSA2",
		"timestamp":    "2026-04-29 01:46:53",
		"total_amount": "1.00",
		"trade_no":     "2026042922001476631454719538",
		"version":      "1.0",
	}

	want := `app_id=2021006147633929&auth_app_id=2021006147633929&charset=utf-8&method=alipay.trade.page.pay.return&out_trade_no=ALIUSR1NOhTqqU21777398396&seller_id=2088480800445650&timestamp=2026-04-29 01:46:53&total_amount=1.00&trade_no=2026042922001476631454719538&version=1.0`
	if got := buildAlipayVerifySignContent(params); got != want {
		t.Fatalf("buildAlipayVerifySignContent() = %q, want %q", got, want)
	}
}
