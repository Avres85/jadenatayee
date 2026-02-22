import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Architecture Flipbook",
  description: "Architecture flipbook mounted to a static compressed portfolio PDF.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const polyfill = `(function(){if(typeof Promise.withResolvers==="function"){return;}var polyfill=function(){var resolve;var reject;var promise=new Promise(function(res,rej){resolve=res;reject=rej;});return{promise:promise,resolve:resolve,reject:reject};};try{Object.defineProperty(Promise,"withResolvers",{value:polyfill,configurable:true,writable:true});}catch(_error){Promise.withResolvers=polyfill;}})();`;

  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: polyfill }} />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
