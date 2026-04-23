/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import React, { useEffect, useRef, useState } from 'react';
import {
  Banner,
  Button,
  Form,
  Row,
  Col,
  Typography,
  Spin,
} from '@douyinfe/semi-ui';
import {
  API,
  removeTrailingSlash,
  showError,
  showSuccess,
} from '../../../helpers';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

export default function SettingsPaymentGatewayAlipay(props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [inputs, setInputs] = useState({
    AlipayEnabled: false,
    AlipayAppID: '',
    AlipayPrivateKey: '',
    AlipayPublicKey: '',
    AlipayNotifyURL: '',
    AlipayReturnURL: '',
    AlipaySubscriptionReturnURL: '',
    AlipayMinTopUp: 1,
  });
  const formApiRef = useRef(null);

  useEffect(() => {
    if (props.options && formApiRef.current) {
      const currentInputs = {
        AlipayEnabled:
          props.options.AlipayEnabled === true ||
          props.options.AlipayEnabled === 'true',
        AlipayAppID: props.options.AlipayAppID || '',
        AlipayPrivateKey: props.options.AlipayPrivateKey || '',
        AlipayPublicKey: props.options.AlipayPublicKey || '',
        AlipayNotifyURL: props.options.AlipayNotifyURL || '',
        AlipayReturnURL: props.options.AlipayReturnURL || '',
        AlipaySubscriptionReturnURL:
          props.options.AlipaySubscriptionReturnURL || '',
        AlipayMinTopUp:
          props.options.AlipayMinTopUp !== undefined
            ? parseFloat(props.options.AlipayMinTopUp) || 1
            : 1,
      };
      setInputs(currentInputs);
      formApiRef.current.setValues(currentInputs);
    }
  }, [props.options]);

  const handleFormChange = (values) => {
    setInputs(values);
  };

  const submitAlipaySetting = async () => {
    setLoading(true);
    try {
      const options = [
        {
          key: 'AlipayEnabled',
          value: inputs.AlipayEnabled ? 'true' : 'false',
        },
        { key: 'AlipayAppID', value: inputs.AlipayAppID || '' },
        { key: 'AlipayPrivateKey', value: inputs.AlipayPrivateKey || '' },
        { key: 'AlipayPublicKey', value: inputs.AlipayPublicKey || '' },
        { key: 'AlipayNotifyURL', value: inputs.AlipayNotifyURL || '' },
        { key: 'AlipayReturnURL', value: inputs.AlipayReturnURL || '' },
        {
          key: 'AlipaySubscriptionReturnURL',
          value: inputs.AlipaySubscriptionReturnURL || '',
        },
        {
          key: 'AlipayMinTopUp',
          value: String(inputs.AlipayMinTopUp || 1),
        },
      ];

      const results = await Promise.all(
        options.map((opt) =>
          API.put('/api/option/', {
            key: opt.key,
            value: opt.value,
          }),
        ),
      );

      const errorResults = results.filter((res) => !res.data.success);
      if (errorResults.length > 0) {
        errorResults.forEach((res) => {
          showError(res.data.message);
        });
      } else {
        showSuccess(t('更新成功'));
        props.refresh?.();
      }
    } catch (error) {
      showError(t('更新失败'));
    } finally {
      setLoading(false);
    }
  };

  const callbackBase = removeTrailingSlash(
    props.options.CustomCallbackAddress || props.options.ServerAddress || '',
  );

  return (
    <Spin spinning={loading}>
      <Form
        initValues={inputs}
        onValueChange={handleFormChange}
        getFormApi={(api) => (formApiRef.current = api)}
      >
        <Form.Section text={t('企业支付宝设置')}>
          <Text>
            {t(
              '企业支付宝直连使用支付宝开放平台电脑网站支付，需提供 AppID、应用私钥和支付宝公钥。',
            )}
          </Text>
          <Banner
            type='info'
            description={
              callbackBase
                ? `${t('默认异步通知地址')}：${callbackBase}/api/user/alipay/notify`
                : t('请先配置服务器地址或回调地址')
            }
          />
          <Banner
            type='info'
            description={
              callbackBase
                ? `${t('默认充值返回地址')}：${callbackBase}/api/user/alipay/return`
                : t('请先配置服务器地址或回调地址')
            }
          />
          <Banner
            type='info'
            description={
              callbackBase
                ? `${t('默认订阅返回地址')}：${callbackBase}/api/subscription/alipay/return`
                : t('请先配置服务器地址或回调地址')
            }
          />

          <Row gutter={{ xs: 8, sm: 16, md: 24, lg: 24, xl: 24, xxl: 24 }}>
            <Col xs={24} sm={24} md={8} lg={8} xl={8}>
              <Form.Switch
                field='AlipayEnabled'
                label={t('启用企业支付宝')}
                size='default'
                checkedText='｜'
                uncheckedText='〇'
              />
            </Col>
            <Col xs={24} sm={24} md={8} lg={8} xl={8}>
              <Form.Input
                field='AlipayAppID'
                label={t('AppID')}
                placeholder={t('支付宝开放平台应用 AppID')}
              />
            </Col>
            <Col xs={24} sm={24} md={8} lg={8} xl={8}>
              <Form.InputNumber
                field='AlipayMinTopUp'
                label={t('最低充值数量')}
                placeholder={t('例如：1')}
                min={1}
                precision={0}
              />
            </Col>
          </Row>

          <Row
            gutter={{ xs: 8, sm: 16, md: 24, lg: 24, xl: 24, xxl: 24 }}
            style={{ marginTop: 16 }}
          >
            <Col xs={24} sm={24} md={12} lg={12} xl={12}>
              <Form.TextArea
                field='AlipayPrivateKey'
                label={t('应用私钥')}
                placeholder={t(
                  '支持 PKCS#1 / PKCS#8 PEM 或 Base64 DER，敏感信息不会发送到前端显示',
                )}
                type='password'
                autosize={{ minRows: 4, maxRows: 8 }}
              />
            </Col>
            <Col xs={24} sm={24} md={12} lg={12} xl={12}>
              <Form.TextArea
                field='AlipayPublicKey'
                label={t('支付宝公钥')}
                placeholder={t(
                  '支持 PEM 或 Base64 DER，敏感信息不会发送到前端显示',
                )}
                type='password'
                autosize={{ minRows: 4, maxRows: 8 }}
              />
            </Col>
          </Row>

          <Row
            gutter={{ xs: 8, sm: 16, md: 24, lg: 24, xl: 24, xxl: 24 }}
            style={{ marginTop: 16 }}
          >
            <Col xs={24} sm={24} md={8} lg={8} xl={8}>
              <Form.Input
                field='AlipayNotifyURL'
                label={t('异步通知地址')}
                placeholder={t('留空则自动使用默认地址')}
                extraText={t('建议填写可被支付宝访问的服务端通知地址')}
              />
            </Col>
            <Col xs={24} sm={24} md={8} lg={8} xl={8}>
              <Form.Input
                field='AlipayReturnURL'
                label={t('充值返回地址')}
                placeholder={t('留空则自动使用默认地址')}
                extraText={t('建议填写服务端充值返回处理地址')}
              />
            </Col>
            <Col xs={24} sm={24} md={8} lg={8} xl={8}>
              <Form.Input
                field='AlipaySubscriptionReturnURL'
                label={t('订阅返回地址')}
                placeholder={t('留空则自动使用默认地址')}
                extraText={t('建议填写服务端订阅返回处理地址')}
              />
            </Col>
          </Row>

          <Button onClick={submitAlipaySetting} style={{ marginTop: 16 }}>
            {t('更新企业支付宝设置')}
          </Button>
        </Form.Section>
      </Form>
    </Spin>
  );
}
