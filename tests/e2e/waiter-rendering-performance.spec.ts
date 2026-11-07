import { test, expect } from "@playwright/test";
import { createServer } from "node:http";

test("mozo conserva catálogo, foco y notas al editar cantidades y refleja cambios reales", async ({ browser }, testInfo) => {
  const { waiterHtml } = await import("../../apps/orders-service/dist/waiter-page.js");
  const server = createServer((req, res) => {
    res.writeHead(req.url === "/waiter" ? 200 : 404, {"content-type":"text/html; charset=utf-8"});
    res.end(req.url === "/waiter" ? waiterHtml : "Not found");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server");
  const context = await browser.newContext({ viewport: {width:390,height:844}, hasTouch:true });
  const page = await context.newPage();
  const unexpected: string[] = [];
  const errors: string[] = [];
  let state = {
    serverNow:new Date().toISOString(), cashSessionId:"test-cash", validUntil:"CASH_CLOSE",
    waiter:{id:"test-waiter",name:"Ana"},
    tables:[{id:"table-1",number:1,name:"Mesa 1",openOrderId:null as string|null}],
    menu:{categories:[{id:"food",name:"Comidas"},{id:"drinks",name:"Bebidas"}],
      products:Array.from({length:120},(_,i)=>({id:`p${i}`,name:`Producto ${i}`,categoryId:i<100?"food":"drinks"}))},
  };
  let failRefresh = false;
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    sessionStorage.setItem("waiter:tenant:v1", "test-tenant");
    sessionStorage.setItem("waiter:terminal:v1", "test-terminal");
    sessionStorage.setItem("waiter:session:v1", "test-token");
  });
  await page.route("**/v1/waiter/**", async route => {
    const request=route.request(), url=new URL(request.url());
    if(url.pathname==="/v1/waiter/rpc" && request.method()==="POST" && request.postDataJSON().method==="waiter.getState") {
      await route.fulfill({status:failRefresh?503:200,json:failRefresh?{error:"offline"}:{requestId:"get-state"}});return;
    }
    if(url.pathname==="/v1/waiter/requests/get-state" && request.method()==="GET") {
      await route.fulfill({json:{status:"completed",result:state}});return;
    }
    unexpected.push(request.method()+" "+url.pathname);
    await route.fulfill({status:500,json:{error:"Unmocked request"}});
  });
  try {
    await page.goto(`http://127.0.0.1:${address.port}/waiter`);
    await expect(page.locator("#products .product")).toHaveCount(100);
    const node = await page.locator("#products .product").first().elementHandle();
    await page.evaluate(() => {
      (window as any).catalogReplacements=0;
      new MutationObserver(records => { (window as any).catalogReplacements+=records.length; })
        .observe(document.getElementById("products")!,{childList:true});
    });
    const add=page.getByRole("button",{name:"Agregar Producto 0",exact:true});
    await add.focus();
    for(let i=0;i<5;i++)await add.press("Enter");
    await expect(page.locator("#draft strong")).toContainText("Producto 0 × 5");
    await expect(add).toBeFocused();
    expect(await node!.evaluate(element=>element.isConnected)).toBe(true);
    expect(await page.evaluate(()=>(window as any).catalogReplacements)).toBe(0);
    const note=page.getByRole("textbox",{name:"Nota para cocina de Producto 0",exact:true});
    await note.fill("Sin sal");
    await page.locator("#reconnect").click();
    await expect(note).toHaveValue("Sin sal");
    expect(await node!.evaluate(element=>element.isConnected)).toBe(true);
    await page.getByRole("button",{name:"Bebidas",exact:true}).click();
    await expect(page.locator("#products .product")).toHaveCount(20);
    expect(await node!.evaluate(element=>element.isConnected)).toBe(false);
    await page.getByRole("button",{name:"Comidas",exact:true}).click();
    state.menu.products[0]!.name="Producto actualizado";
    await page.locator("#reconnect").click();
    await expect(page.getByRole("button",{name:"Agregar Producto actualizado",exact:true})).toBeVisible();
    await expect(page.getByRole("textbox",{name:"Nota para cocina de Producto actualizado",exact:true})).toHaveValue("Sin sal");
    failRefresh=true;
    await page.locator("#reconnect").click();
    await expect(page.locator("#appMessage")).toContainText("Sin conexión con caja");
    await expect(page.locator("#draft strong")).toContainText("× 5");
    for(const width of [320,390]) {
      await page.setViewportSize({width,height:844});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
    await page.screenshot({path:testInfo.outputPath("waiter-catalog.png"),fullPage:true});
    expect(unexpected).toEqual([]);expect(errors).toEqual([]);
  } finally {
    await context.close();server.closeAllConnections();
    await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
});
