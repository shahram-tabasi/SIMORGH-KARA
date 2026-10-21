<#import "template.ftl" as layout>
<@layout.emailLayout title=msg("passwordResetSubject")>
<@layout.heading text="بازنشانی رمز عبور"/>
<p style="margin:0 0 14px 0;"><@layout.greeting/></p>
<p style="margin:0 0 16px 0;">درخواستی برای تعیین رمز تازه برای حساب شما در <strong>${properties.appName}</strong> رسید.</p>
<@layout.facts rows=[["حساب", layout.account()], ["اعتبار پیوند", linkExpirationFormatter(linkExpiration)]]/>
<@layout.button link=link label="تعیین رمز تازه"/>
<@layout.fallback link=link/>
<p style="margin:0 0 6px 0;font-size:13px;line-height:22px;color:#6f6987;">اگر این درخواست از شما نبوده، این پیام را نادیده بگیرید؛ رمز فعلی‌تان تغییری نمی‌کند.</p>
</@layout.emailLayout>
