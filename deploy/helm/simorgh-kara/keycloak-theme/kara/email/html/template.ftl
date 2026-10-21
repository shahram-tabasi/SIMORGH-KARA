<#--
  The frame of every Kara email: dark header with the Kara logo, amber line,
  white card, signature, footer. Right to left, Persian. Written for the
  clients hardest on HTML (Outlook renders with Word): fixed-width centred
  tables, bgcolor attributes as well as styles, no background images, no CSS
  classes. The logo is embedded in the message (cid:, theme.properties).
-->
<#assign font = "Vazirmatn,Tahoma,'Segoe UI',Arial,sans-serif">
<#macro emailLayout title="">
<!DOCTYPE html>
<html lang="fa" dir="rtl" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light">
  <title>${title}</title>
</head>
<body dir="rtl" style="margin:0;padding:0;background-color:#f1eff6;-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f1eff6" dir="rtl" style="background-color:#f1eff6;">
<tr><td align="center" style="padding:28px 10px 8px 10px;">

  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center" dir="rtl"
         style="width:100%;max-width:600px;border-collapse:separate;">

    <#-- Header -->
    <tr><td bgcolor="${properties.inkColor}" align="right" style="background-color:${properties.inkColor};padding:22px 30px;border-radius:12px 12px 0 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" dir="rtl"><tr>
        <td width="60" valign="middle" style="padding-left:14px;">
          <a href="${properties.appUrl}" style="text-decoration:none;">
            <img src="${properties.logoUrl}" width="56" height="60" alt="سیمرغ‌کارا"
                 style="display:block;border:0;outline:none;width:56px;height:60px;color:#ffffff;font-size:20px;">
          </a>
        </td>
        <td valign="middle" align="right" style="font-family:${font};text-align:right;">
          <div style="font-size:22px;line-height:28px;font-weight:800;color:#ffffff;">${properties.appName}</div>
          <div style="font-size:12px;line-height:20px;color:${properties.amberSoft};">${properties.appTagline}</div>
        </td>
      </tr></table>
    </td></tr>
    <tr><td bgcolor="${properties.amberColor}" style="background-color:${properties.amberColor};height:3px;line-height:3px;font-size:0;">&nbsp;</td></tr>

    <#-- Body -->
    <tr><td bgcolor="#ffffff" align="right" dir="rtl" style="background-color:#ffffff;padding:30px 30px 6px 30px;text-align:right;
        font-family:${font};font-size:15px;line-height:27px;color:#1f1b2e;">
      <#nested>
    </td></tr>

    <#-- Signature -->
    <tr><td bgcolor="#ffffff" align="right" style="background-color:#ffffff;padding:8px 30px 30px 30px;border-radius:0 0 12px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" dir="rtl" style="background-color:#ffffff;">
        <tr><td height="1" bgcolor="#e7e3ef" style="background-color:#e7e3ef;height:1px;font-size:1px;line-height:1px;">&nbsp;</td></tr>
        <tr><td height="20" style="height:20px;font-size:1px;line-height:1px;">&nbsp;</td></tr>
        <tr><td align="right" style="font-family:${font};font-size:14px;color:#5b5670;padding-bottom:12px;text-align:right;">با احترام،</td></tr>
        <tr><td align="right">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" dir="rtl"><tr>
            <td valign="top" width="58" style="padding-left:14px;">
              <img src="${properties.logoUrl}" width="52" height="56" alt="" style="display:block;border:0;width:52px;height:56px;">
            </td>
            <td valign="top" width="3" bgcolor="${properties.amberColor}" style="background-color:${properties.amberColor};width:3px;font-size:0;line-height:0;">&nbsp;</td>
            <td valign="top" align="right" style="padding-right:14px;font-family:${font};text-align:right;">
              <div style="font-size:16px;line-height:24px;font-weight:800;color:${properties.inkColor};">${properties.signatureName}</div>
              <#if properties.signatureTitle?has_content>
              <div style="font-size:13px;line-height:20px;color:#b45309;font-weight:600;">${properties.signatureTitle}</div>
              </#if>
              <#if properties.signatureOrg?has_content>
              <div style="font-size:13px;line-height:20px;color:#5b5670;">${properties.signatureOrg}</div>
              </#if>
              <div style="font-size:12px;line-height:20px;color:#5b5670;padding-top:6px;">
                <a href="${properties.appUrl}" dir="ltr" style="color:${properties.buttonColor};text-decoration:none;">${properties.appUrlLabel}</a>
                <#if properties.supportEmail?has_content>
                <br><a href="mailto:${properties.supportEmail}" dir="ltr" style="color:${properties.buttonColor};text-decoration:none;">${properties.supportEmail}</a>
                </#if>
                <#if properties.supportPhone?has_content>
                <br><span dir="ltr" style="color:${properties.inkColor};">${properties.supportPhone}</span>
                </#if>
              </div>
            </td>
          </tr></table>
        </td></tr>
      </table>
    </td></tr>

    <#-- Footer -->
    <tr><td align="center" style="padding:18px 24px 28px 24px;font-family:${font};font-size:11px;line-height:19px;color:#8a849c;">
      این پیام به‌صورت خودکار از ${properties.appName} فرستاده شده است؛ لطفاً به آن پاسخ ندهید.<br>
      &copy; ${.now?string("yyyy")} ${properties.copyright}
    </td></tr>
  </table>

</td></tr>
</table>
</body>
</html>
</#macro>

<#-- Heading of the message. -->
<#macro heading text>
<div style="font-size:21px;line-height:32px;font-weight:800;color:${properties.inkColor};margin:0 0 14px 0;">${text}</div>
</#macro>

<#-- A button that survives Outlook (VML for Word, a table cell elsewhere). -->
<#macro button link label>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="right" style="margin:22px 0 18px 0;"><tr><td>
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
  href="${link}" style="height:46px;v-text-anchor:middle;width:240px;" arcsize="22%" strokecolor="${properties.amberColor}" fillcolor="${properties.buttonColor}">
  <w:anchorlock/>
  <center style="color:#ffffff;font-family:Tahoma,Arial,sans-serif;font-size:15px;font-weight:bold;">${label}</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-->
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
  <td align="center" bgcolor="${properties.buttonColor}"
      style="background-color:${properties.buttonColor};border-radius:10px;border:1px solid ${properties.amberSoft};padding:13px 30px;">
    <a href="${link}" target="_blank"
       style="font-family:${font};font-size:15px;font-weight:700;line-height:20px;color:#ffffff;text-decoration:none;display:inline-block;">${label}&nbsp;&larr;</a>
  </td>
</tr></table>
<!--<![endif]-->
</td></tr></table>
<div style="clear:both;font-size:0;line-height:0;">&nbsp;</div>
</#macro>

<#-- A short facts box. Rows whose value is empty are left out. -->
<#macro facts rows>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl"
       bgcolor="#faf7ff" style="background-color:#faf7ff;border:1px solid #e9e3f5;border-radius:10px;margin:4px 0 6px 0;">
  <tr><td style="padding:10px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl">
    <#list rows as row><#if row[1]?has_content>
      <tr>
        <td valign="top" width="130" align="right" style="padding:3px 0 3px 12px;font-family:${font};font-size:13px;line-height:22px;color:#6f6987;">${row[0]}</td>
        <td valign="top" align="right" style="padding:3px 0;font-family:${font};font-size:13px;line-height:22px;color:#1f1b2e;font-weight:700;">${row[1]}</td>
      </tr>
    </#if></#list>
    </table>
  </td></tr>
</table>
</#macro>

<#-- For clients that drop the button: a short link, not the whole token. -->
<#macro fallback link>
<div style="font-size:12px;line-height:20px;color:#8a849c;margin:0 0 16px 0;">
  دکمه کار نمی‌کند؟ <a href="${link}" target="_blank" style="color:${properties.buttonColor};">این پیوند را باز کنید</a>.
</div>
</#macro>

<#macro greeting><#if user?? && user.firstName?has_content>${user.firstName} عزیز، سلام<#else>سلام،</#if></#macro>

<#function account><#if user?? && user.email?has_content><#return user.email></#if><#if user?? && user.username?has_content><#return user.username></#if><#return ""></#function>
