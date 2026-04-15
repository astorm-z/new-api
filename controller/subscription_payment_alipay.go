package controller

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
)

type SubscriptionAlipayPayRequest struct {
	PlanId int `json:"plan_id"`
}

func SubscriptionRequestAlipayPay(c *gin.Context) {
	var req SubscriptionAlipayPayRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.PlanId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	plan, err := model.GetSubscriptionPlanById(req.PlanId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !plan.Enabled {
		common.ApiErrorMsg(c, "套餐未启用")
		return
	}
	if plan.PriceAmount < 0.01 {
		common.ApiErrorMsg(c, "套餐金额过低")
		return
	}

	client, err := GetAlipayClient()
	if err != nil || client == nil {
		common.ApiErrorMsg(c, "当前管理员未配置企业支付宝支付信息")
		return
	}

	userId := c.GetInt("id")
	if plan.MaxPurchasePerUser > 0 {
		count, err := model.CountUserSubscriptionsByPlan(userId, plan.Id)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if count >= int64(plan.MaxPurchasePerUser) {
			common.ApiErrorMsg(c, "已达到该套餐购买上限")
			return
		}
	}

	callbackAddr := strings.TrimSpace(service.GetCallbackAddress())
	if callbackAddr == "" {
		common.ApiErrorMsg(c, "回调地址配置错误")
		return
	}
	notifyURL := strings.TrimSpace(setting.AlipayNotifyURL)
	if notifyURL == "" {
		notifyURL = callbackAddr + "/api/subscription/alipay/notify"
	}
	returnURL := strings.TrimSpace(setting.AlipaySubscriptionReturnURL)
	if returnURL == "" {
		returnURL = callbackAddr + "/api/subscription/alipay/return"
	}

	tradeNo := fmt.Sprintf("SUBALIUSR%dNO%s%d", userId, common.GetRandomString(6), time.Now().Unix())
	gatewayURL, params, err := client.BuildPagePayParams(&alipayPagePayArgs{
		OutTradeNo: tradeNo,
		Subject:    fmt.Sprintf("订阅套餐 %s", plan.Title),
		TotalAmount: plan.PriceAmount,
		NotifyURL:  notifyURL,
		ReturnURL:  returnURL,
		Body:       "new-api subscription",
	})
	if err != nil {
		common.ApiErrorMsg(c, "拉起支付失败")
		return
	}

	order := &model.SubscriptionOrder{
		UserId:        userId,
		PlanId:        plan.Id,
		Money:         plan.PriceAmount,
		TradeNo:       tradeNo,
		PaymentMethod: PaymentMethodEnterpriseAlipay,
		CreateTime:    time.Now().Unix(),
		Status:        common.TopUpStatusPending,
	}
	if err := order.Insert(); err != nil {
		common.ApiErrorMsg(c, "创建订单失败")
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "success",
		"data":    params,
		"url":     gatewayURL,
	})
}

func SubscriptionAlipayNotify(c *gin.Context) {
	handleAlipayNotify(c)
}

func SubscriptionAlipayReturn(c *gin.Context) {
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
