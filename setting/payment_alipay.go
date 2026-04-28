package setting

const DefaultAlipayExchangeRate = 7.3

var (
	AlipayEnabled               bool
	AlipayAppID                 string
	AlipayPrivateKey            string
	AlipayPublicKey             string
	AlipayNotifyURL             string
	AlipayReturnURL             string
	AlipaySubscriptionReturnURL string
	AlipayMinTopUp              int     = 1
	AlipayExchangeRate          float64 = DefaultAlipayExchangeRate
)
