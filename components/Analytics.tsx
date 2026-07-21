/** GA4 page tag — renders nothing unless NEXT_PUBLIC_GA4_ID is set. */
export function Analytics() {
  const id = process.env.NEXT_PUBLIC_GA4_ID;
  if (!id) return null;
  return (
    <>
      {/* eslint-disable-next-line @next/next/next-script-for-ga */}
      <script async src={`https://www.googletagmanager.com/gtag/js?id=${id}`} />
      <script dangerouslySetInnerHTML={{ __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}');` }} />
    </>
  );
}
