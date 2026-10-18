import { describe, expect, it } from "vitest";
import { createDemoApi, type DemoStorage } from "./demo-api";

class Storage implements DemoStorage { values=new Map<string,string>(); getItem(k:string){return this.values.get(k)??null;} setItem(k:string,v:string){this.values.set(k,v);} removeItem(k:string){this.values.delete(k);} }

describe("demo ingredients and recipes",()=>{
  it("persists ingredients/configuration and recalculates current costs while preserving captured snapshots",async()=>{
    const storage=new Storage(); const api=createDemoApi(storage); const boot=await api.bootstrap();
    const p=boot.products[0]!;
    const ingredient=await api.saveIngredient({name:"Harina",presentation:"Bolsa 16 kg",baseUnit:"KG",presentationQuantityMicros:16_000_000,presentationCostMinor:1_600_000});
    await expect(api.setProductCostConfiguration({productId:p.id,recipeEnabled:false,recipeItems:[{ingredientId:ingredient.id,quantityMicros:0}],manualUnitCostMinor:null})).rejects.toThrow();
    const config={productId:p.id,recipeEnabled:true,recipeItems:[{ingredientId:ingredient.id,quantityMicros:300_000}],manualUnitCostMinor:null};
    await api.setProductCostConfiguration(config);
    expect(await api.getProductCostConfiguration({productId:p.id})).toEqual(config);
    const today=new Date().toISOString().slice(0,10);
    const first=await api.createOrder({type:"TAKEAWAY",customerName:"Costo receta",customerPhone:"11 1234-5678"});
    await api.addOrderItem({orderId:first.id,productId:p.id}); await api.confirmOrder({orderId:first.id});
    const before=(await api.getFinanceReport({from:today,to:today})).cogsMinor;
    const reloaded=createDemoApi(storage);
    expect(await reloaded.listIngredients()).toHaveLength(1);
    await reloaded.saveIngredient({...ingredient,ingredientId:ingredient.id,presentationCostMinor:3_200_000});
    expect((await reloaded.getFinanceProductCosts()).find((x)=>x.productId===p.id)?.source).toBe("RECIPE");
    expect((await reloaded.getFinanceReport({from:today,to:today})).cogsMinor).toBe(before);
  });
});
