package controller

import (
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

type AlipayPayRequest struct {
	Amount        int64  `json:"amount"`
	PaymentMethod string `json:"payment_method"`
	DirectCNY     bool   `json:"direct_cny"`
}

type AlipayAmountRequest struct {
	Amount    int64 `json:"amount"`
	DirectCNY bool  `json:"direct_cny"`
}

func shouldUseAlipayDirectCNYRequest(directCNY bool) bool {
	return directCNY &&
		operation_setting.GetQuotaDisplayType() == operation_setting.QuotaDisplayTypeCNY &&
		operation_setting.USDExchangeRate > 0
}

func getAlipayMinTopup(directCNY bool) int64 {
	minTopup := setting.AlipayMinTopUp
	if operation_setting.GetQuotaDisplayType() == operation_setting.QuotaDisplayTypeTokens {
		minTopup = minTopup * int(common.QuotaPerUnit)
	} else if shouldUseAlipayDirectCNYRequest(directCNY) {
		minTopup = int(math.Round(float64(minTopup) * operation_setting.USDExchangeRate))
		if minTopup < 1 {
			minTopup = 1
		}
	}
	return int64(minTopup)
}

func getAlipayPayMoney(amount int64, group string, directCNY bool) float64 {
	originalAmount := amount
	dAmount := decimal.NewFromInt(amount)
	if operation_setting.GetQuotaDisplayType() == operation_setting.QuotaDisplayTypeTokens {
		dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
		dAmount = dAmount.Div(dQuotaPerUnit)
	} else if shouldUseAlipayDirectCNYRequest(directCNY) {
		dRate := decimal.NewFromFloat(operation_setting.USDExchangeRate)
		if dRate.LessThanOrEqual(decimal.Zero) {
			return 0
		}
		dAmount = dAmount.Div(dRate)
		originalAmount = int64(math.Round(float64(amount) / operation_setting.USDExchangeRate))
	}

	topupGroupRatio := common.GetTopupGroupRatio(group)
	if topupGroupRatio == 0 {
		topupGroupRatio = 1
	}

	dTopupGroupRatio := decimal.NewFromFloat(topupGroupRatio)
	dPrice := decimal.NewFromFloat(operation_setting.Price)
	discount := 1.0
	if ds, ok := operation_setting.GetPaymentSetting().AmountDiscount[int(originalAmount)]; ok {
		if ds > 0 {
			discount = ds
		}
	}
	dDiscount := decimal.NewFromFloat(discount)

	payMoney := dAmount.Mul(dPrice).Mul(dTopupGroupRatio).Mul(dDiscount)
	return payMoney.InexactFloat64()
}

func RequestAlipayAmount(c *gin.Context) {
	var req AlipayAmountRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "参数错误"})
		return
	}
	minTopup := getAlipayMinTopup(req.DirectCNY)
	if req.Amount < minTopup {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": fmt.Sprintf("充值数量不能小于 %d", minTopup)})
		return
	}

	id := c.GetInt("id")
	group, err := model.GetUserGroup(id, true)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "获取用户分组失败"})
		return
	}
	payMoney := getAlipayPayMoney(req.Amount, group, req.DirectCNY)
	if payMoney <= 0.01 {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "充值金额过低"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "success", "data": formatAlipayMoney(payMoney)})
}

func RequestAlipayPay(c *gin.Context) {
	var req AlipayPayRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "参数错误"})
		return
	}
	if req.PaymentMethod != PaymentMethodEnterpriseAlipay {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "不支持的支付渠道"})
		return
	}
	minTopup := getAlipayMinTopup(req.DirectCNY)
	if req.Amount < minTopup {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": fmt.Sprintf("充值数量不能小于 %d", minTopup)})
		return
	}

	id := c.GetInt("id")
	group, err := model.GetUserGroup(id, true)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "获取用户分组失败"})
		return
	}
	payMoney := getAlipayPayMoney(req.Amount, group, req.DirectCNY)
	if payMoney < 0.01 {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "充值金额过低"})
		return
	}

	client, err := GetAlipayClient()
	if err != nil || client == nil {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "当前管理员未配置企业支付宝支付信息"})
		return
	}

	notifyURL := strings.TrimSpace(setting.AlipayNotifyURL)
	if notifyURL == "" {
		callbackAddr := strings.TrimSpace(service.GetCallbackAddress())
		if callbackAddr == "" {
			c.JSON(http.StatusOK, gin.H{"message": "error", "data": "回调地址配置错误"})
			return
		}
		notifyURL = callbackAddr + "/api/user/alipay/notify"
	}
	returnURL := strings.TrimSpace(setting.AlipayReturnURL)
	if returnURL == "" {
		callbackAddr := strings.TrimSpace(service.GetCallbackAddress())
		if callbackAddr == "" {
			c.JSON(http.StatusOK, gin.H{"message": "error", "data": "回调地址配置错误"})
			return
		}
		returnURL = callbackAddr + "/api/user/alipay/return"
	}

	tradeNo := fmt.Sprintf("ALIUSR%dNO%s%d", id, common.GetRandomString(6), time.Now().Unix())
	gatewayURL, params, err := client.BuildPagePayParams(&alipayPagePayArgs{
		OutTradeNo: tradeNo,
		Subject:    fmt.Sprintf("账户充值 %d", req.Amount),
		TotalAmount: payMoney,
		NotifyURL:  notifyURL,
		ReturnURL:  returnURL,
		Body:       "new-api topup",
	})
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "拉起支付失败"})
		return
	}

	amount := req.Amount
	if operation_setting.GetQuotaDisplayType() == operation_setting.QuotaDisplayTypeTokens {
		dAmount := decimal.NewFromInt(amount)
		dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
		amount = dAmount.Div(dQuotaPerUnit).IntPart()
	}

	topUp := &model.TopUp{
		UserId:        id,
		Amount:        amount,
		Money:         payMoney,
		TradeNo:       tradeNo,
		PaymentMethod: func() string {
			if shouldUseAlipayDirectCNYRequest(req.DirectCNY) {
				return PaymentMethodEnterpriseAlipayCNY
			}
			return PaymentMethodEnterpriseAlipay
		}(),
		CreateTime:    time.Now().Unix(),
		Status:        common.TopUpStatusPending,
	}
	if err := topUp.Insert(); err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "创建订单失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "success",
		"data":    params,
		"url":     gatewayURL,
	})
}

func AlipayNotify(c *gin.Context) {
	handleAlipayNotify(c)
}

func AlipayReturn(c *gin.Context) {
	params, err := getAlipayRequestParams(c)
	if err != nil || len(params) == 0 {
		c.Redirect(http.StatusFound, getAlipayConsoleTopupURL("fail"))
		return
	}

	client, err := GetAlipayClient()
	if err != nil || client == nil {
		c.Redirect(http.StatusFound, getAlipayConsoleTopupURL("fail"))
		return
	}
	verifyInfo, err := client.Verify(params)
	if err != nil {
		c.Redirect(http.StatusFound, getAlipayConsoleTopupURL("fail"))
		return
	}

	if isAlipayTradeSuccess(verifyInfo.TradeStatus) {
		if err := completeAlipayTrade(verifyInfo); err != nil {
			c.Redirect(http.StatusFound, getAlipayConsoleTopupURL("fail"))
			return
		}
		c.Redirect(http.StatusFound, getAlipayConsoleTopupURL("success"))
		return
	}

	if isAlipayTradeClosed(verifyInfo.TradeStatus) {
		expireAlipayTrade(verifyInfo.OutTradeNo)
		c.Redirect(http.StatusFound, getAlipayConsoleTopupURL("fail"))
		return
	}

	c.Redirect(http.StatusFound, getAlipayConsoleTopupURL("pending"))
}

func handleAlipayNotify(c *gin.Context) {
	params, err := getAlipayRequestParams(c)
	if err != nil || len(params) == 0 {
		c.String(http.StatusOK, "failure")
		return
	}

	client, err := GetAlipayClient()
	if err != nil || client == nil {
		c.String(http.StatusOK, "failure")
		return
	}
	verifyInfo, err := client.Verify(params)
	if err != nil {
		c.String(http.StatusOK, "failure")
		return
	}

	if isAlipayTradeSuccess(verifyInfo.TradeStatus) {
		if err := completeAlipayTrade(verifyInfo); err != nil {
			c.String(http.StatusOK, "failure")
			return
		}
		c.String(http.StatusOK, "success")
		return
	}

	if isAlipayTradeClosed(verifyInfo.TradeStatus) {
		expireAlipayTrade(verifyInfo.OutTradeNo)
		c.String(http.StatusOK, "success")
		return
	}

	c.String(http.StatusOK, "success")
}

func completeAlipayTrade(verifyInfo *alipayVerifyInfo) error {
	if verifyInfo == nil || verifyInfo.OutTradeNo == "" {
		return fmt.Errorf("invalid alipay trade")
	}

	if model.GetTopUpByTradeNo(verifyInfo.OutTradeNo) != nil {
		return completeAlipayTopUp(verifyInfo)
	}
	if model.GetSubscriptionOrderByTradeNo(verifyInfo.OutTradeNo) != nil {
		return completeAlipaySubscription(verifyInfo)
	}
	return fmt.Errorf("payment order not found")
}

func expireAlipayTrade(tradeNo string) {
	if tradeNo == "" {
		return
	}
	if topUp := model.GetTopUpByTradeNo(tradeNo); topUp != nil {
		LockOrder(tradeNo)
		defer UnlockOrder(tradeNo)
		if latest := model.GetTopUpByTradeNo(tradeNo); latest != nil && latest.Status == common.TopUpStatusPending {
			latest.Status = common.TopUpStatusExpired
			latest.CompleteTime = common.GetTimestamp()
			_ = latest.Update()
		}
		return
	}
	if model.GetSubscriptionOrderByTradeNo(tradeNo) != nil {
		LockOrder(tradeNo)
		defer UnlockOrder(tradeNo)
		_ = model.ExpireSubscriptionOrder(tradeNo)
	}
}

func completeAlipayTopUp(verifyInfo *alipayVerifyInfo) error {
	LockOrder(verifyInfo.OutTradeNo)
	defer UnlockOrder(verifyInfo.OutTradeNo)

	latest := model.GetTopUpByTradeNo(verifyInfo.OutTradeNo)
	if latest == nil {
		return fmt.Errorf("充值订单不存在")
	}
	if latest.Status == common.TopUpStatusSuccess {
		return nil
	}
	if latest.PaymentMethod != PaymentMethodEnterpriseAlipay &&
		latest.PaymentMethod != PaymentMethodEnterpriseAlipayCNY {
		return fmt.Errorf("支付方式不匹配")
	}
	if !isAlipayAmountMatched(latest.Money, verifyInfo.TotalAmount) {
		return fmt.Errorf("支付金额校验失败")
	}
	return model.RechargeAlipay(verifyInfo.OutTradeNo)
}

func completeAlipaySubscription(verifyInfo *alipayVerifyInfo) error {
	LockOrder(verifyInfo.OutTradeNo)
	defer UnlockOrder(verifyInfo.OutTradeNo)

	latest := model.GetSubscriptionOrderByTradeNo(verifyInfo.OutTradeNo)
	if latest == nil {
		return fmt.Errorf("订阅订单不存在")
	}
	if latest.Status == common.TopUpStatusSuccess {
		return nil
	}
	if latest.PaymentMethod != PaymentMethodEnterpriseAlipay {
		return fmt.Errorf("支付方式不匹配")
	}
	if !isAlipayAmountMatched(latest.Money, verifyInfo.TotalAmount) {
		return fmt.Errorf("支付金额校验失败")
	}
	return model.CompleteSubscriptionOrder(verifyInfo.OutTradeNo, common.GetJsonString(verifyInfo.RawParams))
}

func isAlipayAmountMatched(expected, actual float64) bool {
	return math.Abs(expected-actual) <= 0.01
}

func getAlipayConsoleTopupURL(payStatus string) string {
	baseURL := strings.TrimRight(system_setting.ServerAddress, "/")
	if baseURL == "" {
		return "/console/topup?show_history=true&pay=" + payStatus
	}
	return baseURL + "/console/topup?show_history=true&pay=" + payStatus
}
