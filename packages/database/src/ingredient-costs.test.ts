import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteGastronomyRepository } from "./sqlite-repository";

test("ingredientes y receta persisten, recalculan el costo vigente y legacy desactiva receta",()=>{
  const dir=mkdtempSync(join(tmpdir(),"ingredient-costs-")); const path=join(dir,"db.sqlite");
  let repo=new SqliteGastronomyRepository(path,{adminPin:"2468",seedStarterCatalog:true});
  try {
    const product=repo.bootstrap().products[0]!;
    const ingredient=repo.saveIngredient({name:"Harina",presentation:"Bolsa 16 kg",baseUnit:"KG",presentationQuantityMicros:16_000_000,presentationCostMinor:1_600_000});
    const config={productId:product.id,recipeEnabled:true,recipeItems:[{ingredientId:ingredient.id,quantityMicros:300_000}],manualUnitCostMinor:null};
    assert.throws(()=>repo.setProductCostConfiguration({...config,recipeEnabled:false,recipeItems:[{ingredientId:ingredient.id,quantityMicros:0}]}));
    assert.equal(repo.getProductCostConfiguration({productId:product.id}).manualUnitCostMinor,null);
    repo.setProductCostConfiguration(config);
    assert.equal(repo.getFinanceProductCosts().find(c=>c.productId===product.id)?.unitCostMinor,30_000);
    assert.throws(()=>repo.saveIngredient({...ingredient,ingredientId:ingredient.id,baseUnit:"L"}),/unidad/i);
    repo.saveIngredient({...ingredient,ingredientId:ingredient.id,presentationCostMinor:3_200_000});
    assert.equal(repo.getFinanceProductCosts().find(c=>c.productId===product.id)?.unitCostMinor,60_000);
    repo.close();
    repo=new SqliteGastronomyRepository(path,{adminPin:"2468",seedStarterCatalog:true});
    assert.equal(repo.getProductCostConfiguration({productId:product.id}).recipeEnabled,true);
    repo.setFinanceProductCost({productId:product.id,unitCostMinor:700});
    assert.equal(repo.getFinanceProductCosts().find(c=>c.productId===product.id)?.source,"MANUAL");
    const a=repo.saveIngredient({name:"A",presentation:"unidad",baseUnit:"UNIT",presentationQuantityMicros:1,presentationCostMinor:1});
    const b=repo.saveIngredient({name:"B",presentation:"unidad",baseUnit:"UNIT",presentationQuantityMicros:1,presentationCostMinor:1});
    repo.setProductCostConfiguration({productId:product.id,recipeEnabled:true,recipeItems:[{ingredientId:a.id,quantityMicros:1},{ingredientId:b.id,quantityMicros:1}],manualUnitCostMinor:null});
    assert.throws(()=>repo.saveIngredient({...a,ingredientId:a.id,presentationCostMinor:Number.MAX_SAFE_INTEGER}),/rango/i);
    assert.equal((awaitIngredient(repo,a.id)).presentationCostMinor,1);
  } finally { repo.close(); rmSync(dir,{recursive:true,force:true}); }
});

function awaitIngredient(repo:SqliteGastronomyRepository,id:string){return repo.listIngredients().find((ingredient)=>ingredient.id===id)!;}
