<#outputformat "plainText">
<#assign requiredActionsText><#if requiredActions??><#list requiredActions><#items as reqActionItem>${msg("requiredAction.${reqActionItem}")}<#sep>، </#sep></#items></#list></#if></#assign>
</#outputformat>
<#import "template.ftl" as layout>
<@layout.emailLayout title=msg("executeActionsSubject")>
<@layout.heading text="حساب شما در سیمرغ‌کارا آماده است"/>
<p style="margin:0 0 14px 0;"><@layout.greeting/></p>
<p style="margin:0 0 16px 0;">برای شما در <strong>${properties.appName}</strong> حساب کاربری ساخته شد. با دکمهٔ زیر رمز عبور خود را تعیین کنید و وارد شوید.</p>
<@layout.facts rows=[["حساب", layout.account()], ["کار لازم", requiredActionsText], ["اعتبار پیوند", linkExpirationFormatter(linkExpiration)]]/>
<@layout.button link=link label="تعیین رمز و ورود"/>
<@layout.fallback link=link/>
<p style="margin:0 0 6px 0;font-size:13px;line-height:22px;color:#6f6987;">اگر انتظار این پیام را نداشتید، به مدیر سامانهٔ شرکت خود خبر دهید.</p>
</@layout.emailLayout>
