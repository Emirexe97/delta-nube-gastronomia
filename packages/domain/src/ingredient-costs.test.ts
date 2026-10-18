import test from "node:test";
import assert from "node:assert/strict";
import { assertIngredientValues, calculateIngredientRecipeCost } from "./ingredient-costs";
import type { IngredientDto } from "@gastronomy/contracts";

const flour: IngredientDto = { id:"flour",name:"Harina",presentation:"Bolsa 16 kg",baseUnit:"KG",presentationQuantityMicros:16_000_000,presentationCostMinor:1_600_000 };
test("calcula costo proporcional y suma redondeos por ingrediente",()=>{
  assert.equal(calculateIngredientRecipeCost([{ingredientId:"flour",quantityMicros:300_000}],[flour]),30_000);
  const sugar={...flour,id:"sugar",presentationQuantityMicros:2_000_000,presentationCostMinor:100_000};
  assert.equal(calculateIngredientRecipeCost([{ingredientId:"flour",quantityMicros:300_000},{ingredientId:"sugar",quantityMicros:1_000_000}],[flour,sugar]),80_000);
});
test("rechaza recetas inválidas y valores fuera de rango",()=>{
  assert.throws(()=>calculateIngredientRecipeCost([],[flour]));
  assert.throws(()=>calculateIngredientRecipeCost([{ingredientId:"flour",quantityMicros:1},{ingredientId:"flour",quantityMicros:1}],[flour]));
  assert.throws(()=>calculateIngredientRecipeCost([{ingredientId:"absent",quantityMicros:1}],[flour]));
  assert.throws(()=>assertIngredientValues({...flour,presentationQuantityMicros:0}));
});
test("admite medio gramo, costo cero y redondea cada línea al centavo",()=>{
  assert.equal(calculateIngredientRecipeCost([{ingredientId:"flour",quantityMicros:500}],[flour]),50);
  assert.equal(calculateIngredientRecipeCost([{ingredientId:"free",quantityMicros:1}],[{...flour,id:"free",presentationQuantityMicros:2,presentationCostMinor:1}]),1);
  assert.equal(calculateIngredientRecipeCost([{ingredientId:"zero",quantityMicros:800}],[{...flour,id:"zero",presentationCostMinor:0}]),0);
});
test("rechaza cantidades no positivas o no enteras y totales no seguros",()=>{
  for(const quantityMicros of [-1,0,NaN,1.5]) assert.throws(()=>calculateIngredientRecipeCost([{ingredientId:"flour",quantityMicros}],[flour]));
  const costly=[{...flour,id:"a",presentationQuantityMicros:1,presentationCostMinor:Number.MAX_SAFE_INTEGER},{...flour,id:"b",presentationQuantityMicros:1,presentationCostMinor:Number.MAX_SAFE_INTEGER}];
  assert.throws(()=>calculateIngredientRecipeCost([{ingredientId:"a",quantityMicros:1},{ingredientId:"b",quantityMicros:1}],costly),/rango/i);
  assert.throws(()=>assertIngredientValues({...flour,presentationCostMinor:-1}));
  assert.throws(()=>assertIngredientValues({...flour,presentationCostMinor:NaN}));
  assert.throws(()=>assertIngredientValues({...flour,presentationCostMinor:1.5}));
});
