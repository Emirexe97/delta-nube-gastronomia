import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,rm,readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join,resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OrdersStore } from "../dist/store.js";
import { createOrdersServer } from "../dist/server.js";
import { createTenantStorefront } from "../dist/tenant-storefront.js";
import { issueWebSiteTicket } from "@gastronomy/web-orders/provision";
import { DatabaseSync } from "node:sqlite";
import { parseBannerDataUrl } from "../dist/banner-image.js";
import { createHash } from "node:crypto";

const square=await readFile(fileURLToPath(new URL("./banner-fixture.jpg",import.meta.url)));
const photo1=await readFile(fileURLToPath(new URL("./banner-fixture-2.jpg",import.meta.url)));
const photo2=Buffer.from(square);
const data=(b)=>`data:image/jpeg;base64,${b.toString("base64")}`;
const secret="0123456789abcdef0123456789abcdef";
const catalog=(refs)=>({products:refs.map(productRef=>({productRef,name:productRef,category:"Cat",takeawayPriceMinor:100,deliveryPriceMinor:100}))});

test("tenant logo and product photo APIs preserve compatibility, visibility and tenant isolation",async(t)=>{
  const dir=await mkdtemp(join(tmpdir(),"tenant-product-media-")),dbPath=resolve(dir,"orders.sqlite");
  const service=createOrdersServer({dbPath,stores:[],provisioning:{secret,baseDomain:"food.example"}});
  await new Promise(r=>service.server.listen(0,"127.0.0.1",r));
  const base=`http://127.0.0.1:${service.server.address().port}`;
  const sites={};
  for(const slug of ["media-a","media-b"]){
    const installationId=`pos-${slug}`;
    const ticket=issueWebSiteTicket({licenseId:`lic-${slug}`,installationId,businessName:slug},secret);
    const result=await fetch(base+"/v1/web-sites",{method:"POST",headers:{authorization:`Bearer ${ticket}`,"content-type":"application/json"},body:JSON.stringify({slug,whatsappNumber:"5491112345678"})});
    assert.equal(result.status,201); sites[slug]={...(await result.json()),installationId};
  }
  let storefront, http;
  t.after(async()=>{if(http){http.closeAllConnections();await new Promise(r=>http.close(r));} storefront?.close();service.server.closeAllConnections();await service.close();await rm(dir,{recursive:true,force:true});});
  const headers=(site)=>({authorization:`Bearer ${site.receiveToken}`,"x-pos-installation":site.installationId,"content-type":"application/json"});
  const a=sites["media-a"], b=sites["media-b"], baseFields={displayName:"Media A",tagline:"",accent:"#123456"};
  let response=await fetch(base+"/v1/web-sites/branding",{headers:headers(a)});
  assert.equal(Object.hasOwn(await response.json(),"logoDataUrl"),false,"old branding response has no new keys");
  response=await fetch(base+"/v1/web-sites/branding",{headers:{...headers(a),"x-web-site-media":"1"}});
  assert.equal((await response.json()).logoDataUrl,null);
  response=await fetch(base+"/v1/web-sites/branding",{method:"PATCH",headers:{...headers(a),"x-web-site-media":"1"},body:JSON.stringify({...baseFields,logoDataUrl:data(square),productPhoto:{productRef:"SKU:one",dataUrl:data(photo1)}})});
  assert.equal(response.status,200); assert.equal((await response.json()).logoDataUrl,data(square));
  response=await fetch(base+"/v1/web-sites/product-photo/SKU%3Aone",{headers:headers(a)});
  assert.deepEqual(await response.json(),{productRef:"SKU:one",dataUrl:data(photo1)},"private photo read works before public visibility");
  response=await fetch(base+"/v1/web-sites/product-photo/SKU%3Aone",{headers:headers(b)});
  assert.deepEqual(await response.json(),{productRef:"SKU:one",dataUrl:null},"tenant isolation on private reads");
  response=await fetch(base+"/v1/web-sites/product-photo/SKU%3Aone"); assert.equal(response.status,401);
  storefront=createTenantStorefront({dbPath,hostSuffix:"food.example",protocol:"http"});
  http=(await import("node:http")).createServer((req,res)=>void storefront.handle(req,res,req.headers["x-test-host"]).then(handled=>{if(!handled){res.writeHead(404);res.end();}}));
  await new Promise(r=>http.listen(0,"127.0.0.1",r));
  const publicGet=(slug,path)=>fetch(`http://127.0.0.1:${http.address().port}${path}`,{headers:{"x-test-host":`${slug}.food.example`}});
  assert.equal((await publicGet("media-a","/media/products/SKU%3Aone.jpg")).status,404,"unpublished products are hidden");
  const publish=async(refs)=>fetch(base+"/v1/web-catalog",{method:"PUT",headers:{authorization:`Bearer ${a.receiveToken}`,"x-pos-installation":a.installationId,"x-expected-store-id":a.storeId,"content-type":"application/json"},body:JSON.stringify(catalog(refs))});
  let published=await publish(["SKU:one"]); assert.equal(published.status,200,await published.clone().text());
  assert.equal((await publicGet("media-a","/media/products/SKU%3Aone.jpg")).status,200);
  assert.equal((await publicGet("media-a","/media/logo.jpg")).status,200);
  let catalogResponse=await publicGet("media-a","/api/catalog");
  let envelope=await catalogResponse.json(); assert.deepEqual(envelope.productPhotos,[{productRef:"SKU:one",version:createHash("sha256").update(photo1).digest("hex")}]);
  published=await publish(["SKU:two"]); assert.equal(published.status,200,await published.clone().text());
  assert.equal((await publicGet("media-a","/media/products/SKU%3Aone.jpg")).status,404,"removed catalog products become private at publish time");
  response=await fetch(base+"/v1/web-sites/branding",{method:"PATCH",headers:{...headers(a),"x-web-site-media":"1"},body:JSON.stringify({...baseFields,productPhoto:{productRef:"SKU:one",dataUrl:data(photo2)}})});
  assert.equal(response.status,200,"can prepare a product before it is catalog-visible");
  published=await publish(["SKU:one"]); assert.equal(published.status,200,await published.clone().text());
  catalogResponse=await publicGet("media-a","/api/catalog"); envelope=await catalogResponse.json(); assert.equal(envelope.productPhotos.length,1);
  assert.equal((await publicGet("media-b","/media/products/SKU%3Aone.jpg")).status,404,"public host isolation");
  response=await fetch(base+"/v1/web-sites/branding",{method:"PATCH",headers:{...headers(a),"x-web-site-media":"1"},body:JSON.stringify({...baseFields,productPhoto:{productRef:"SKU:one",dataUrl:null},logoDataUrl:null})});
  assert.equal(response.status,200);
  assert.equal((await publicGet("media-a","/media/products/SKU%3Aone.jpg")).status,404);
  assert.equal((await publicGet("media-a","/media/logo.jpg")).status,404);
});

test("logo requires square JPEG and old database migrations add empty media fields",async(t)=>{
  const dir=await mkdtemp(join(tmpdir(),"tenant-media-migration-")),dbPath=resolve(dir,"orders.sqlite");
  assert.throws(()=>parseBannerDataUrl(data(photo1),{maxBytes:96*1024,maxWidth:384,maxHeight:384,square:true}));
  const legacy=new DatabaseSync(dbPath);
  legacy.exec("CREATE TABLE tenant_sites(license_id TEXT PRIMARY KEY,installation_id TEXT NOT NULL UNIQUE,store_id TEXT NOT NULL UNIQUE,slug TEXT NOT NULL UNIQUE,display_name TEXT NOT NULL,tagline TEXT NOT NULL DEFAULT '',accent TEXT NOT NULL DEFAULT '#1f6f50',design_mode TEXT NOT NULL DEFAULT 'STANDARD',template_key TEXT,receive_hash TEXT NOT NULL UNIQUE,access_until TEXT)"); legacy.close();
  const db=new OrdersStore(dbPath,[]);
  t.after(async()=>{db.close();await rm(dir,{recursive:true,force:true});});
  const columns=db.db.prepare("PRAGMA table_info(tenant_sites)").all().map(row=>row.name);
  assert.ok(columns.includes("has_logo") && columns.includes("logo_data"));
  const tenant=db.provisionTenant({licenseId:"legacy",installationId:"legacy-pos",businessName:"Legacy",slug:"legacy",whatsappNumber:"5491112345678",receiveToken:"legacy-token"});
  assert.equal(db.getTenantBySlug("legacy").has_logo,0);
  assert.equal(db.getTenantBranding(tenant.storeId,false,true).logoDataUrl,null);
});

test("product photo slots are capped at five thousand per tenant and rejected patch stays atomic",async(t)=>{
  const dir=await mkdtemp(join(tmpdir(),"tenant-photo-limit-")),dbPath=resolve(dir,"orders.sqlite");
  const db=new OrdersStore(dbPath,[]);
  t.after(async()=>{db.close();await rm(dir,{recursive:true,force:true});});
  const tenant=db.provisionTenant({licenseId:"limit",installationId:"limit-pos",businessName:"Limit",slug:"limit",whatsappNumber:"5491112345678",receiveToken:"limit-token"});
  const insert=db.db.prepare("INSERT INTO tenant_product_photos(store_id,product_ref,image_data,version,is_visible) VALUES(?,?,?, ?,0)");
  db.db.exec("BEGIN"); for(let i=0;i<5000;i++)insert.run(tenant.storeId,`P${i}`,square,"0".repeat(64)); db.db.exec("COMMIT");
  assert.throws(()=>db.updateTenantBranding(tenant.storeId,{displayName:"Must Roll Back",tagline:"",accent:"#123456",productPhoto:{productRef:"P5000",image:photo1}}),e=>e.code==="product_photo_limit");
  assert.equal(db.getTenantBranding(tenant.storeId).displayName,"Limit");
  assert.equal(db.getTenantProductPhoto(tenant.storeId,"P5000"),undefined);
});

test("image downloads use a separate bounded bucket and cannot consume the catalog request budget",async(t)=>{
  const dir=await mkdtemp(join(tmpdir(),"tenant-media-rate-")),dbPath=resolve(dir,"orders.sqlite");
  const db=new OrdersStore(dbPath,[]);
  const site=db.provisionTenant({licenseId:"rate",installationId:"rate-pos",businessName:"Rate",slug:"rate",whatsappNumber:"5491112345678",receiveToken:"rate-token"});
  db.close();
  const handler=createTenantStorefront({dbPath,hostSuffix:"food.example",protocol:"http",rateLimit:1,mediaRateLimit:4});
  const server=(await import("node:http")).createServer((req,res)=>void handler.handle(req,res,req.headers["x-test-host"]).then(handled=>{if(!handled){res.writeHead(404);res.end();}}));
  await new Promise(r=>server.listen(0,"127.0.0.1",r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));handler.close();await rm(dir,{recursive:true,force:true});});
  const get=path=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{headers:{"x-test-host":"rate.food.example"}});
  assert.equal((await get("/media/logo.jpg")).status,404);
  assert.equal((await get("/media/banner.jpg")).status,404);
  assert.equal((await get("/api/catalog")).status,200,"images do not consume normal request bucket");
  assert.equal((await get("/api/catalog")).status,429,"normal catalog calls retain their independent configured limit");
});
