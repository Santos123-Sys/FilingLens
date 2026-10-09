import {describe,expect,it,vi} from "vitest";
import {validOperatorContact,safeOidcEndpoint,provisionContact} from "./sec-contact-from-railway";

describe("SEC contact provisioning from Railway",()=>{
 it("accepts the genuine configured operator contact",()=>{
  expect(validOperatorContact("operator@example.org")).toBe(true);
  expect(validOperatorContact("nobody")).toBe(false);
  expect(validOperatorContact("name@example.com\nBAD=value")).toBe(false);
  expect(validOperatorContact("x".repeat(200)+"@example.com")).toBe(false);
 });
 it("pins the GitHub OIDC request to an official Actions hostname",()=>{
  expect(safeOidcEndpoint("https://pipelines.actions.githubusercontent.com/path").hostname)
   .toBe("pipelines.actions.githubusercontent.com");
  expect(()=>safeOidcEndpoint("https://attacker.example/path")).toThrow();
  expect(()=>safeOidcEndpoint("https://pipelines.actions.githubusercontent.com.evil.org/path")).toThrow();
  expect(()=>safeOidcEndpoint("http://pipelines.actions.githubusercontent.com/path")).toThrow();
 });
 it("never proceeds with an unsigned/missing GitHub Actions identity",async()=>{
  const previous=process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const request=vi.fn() as unknown as typeof fetch;
  try{
   await expect(provisionContact(request)).rejects.toThrow(/Missing GitHub Actions/);
   expect(request).not.toHaveBeenCalled();
  }finally{
   if(previous===undefined)delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
   else process.env.ACTIONS_ID_TOKEN_REQUEST_URL=previous;
  }
 });
});
