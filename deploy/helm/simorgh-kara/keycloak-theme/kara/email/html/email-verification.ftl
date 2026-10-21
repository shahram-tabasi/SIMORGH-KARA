<#import "template.ftl" as layout>
<@layout.emailLayout title=msg("emailVerificationSubject")>
<@layout.heading text="تأیید نشانی ایمیل"/>
<p style="margin:0 0 14px 0;"><@layout.greeting/></p>
<p style="margin:0 0 16px 0;">لطفاً تأیید کنید که این نشانی متعلق به شماست؛ پیام‌های حساب ${properties.appName} به آن فرستاده می‌شود.</p>
<@layout.facts rows=[["حساب", layout.account()], ["اعتبار پیوند", linkExpirationFormatter(linkExpiration)]]/>
<@layout.button link=link label="تأیید ایمیل"/>
<@layout.fallback link=link/>
<p style="margin:0 0 6px 0;font-size:13px;line-height:22px;color:#6f6987;">اگر انتظار این پیام را نداشتید، آن را نادیده بگیرید.</p>
</@layout.emailLayout>
