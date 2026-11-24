import { describe,expect,it } from "vitest";
import { receiptHtml, type PaymentReceipt } from "./receipt";

const receipt:PaymentReceipt={receiptNo:"SWP-RCPT-000001",paidAt:"2026-11-24T10:00:00.000Z",amount:800,refundedAmount:0,netAmount:800,method:"UPI",reference:"TX-1",member:{publicId:"SWP-000001",fullName:"Karan <Bhor>",mobile:"9000000000"},library:{name:"Swapnapurti Library",address:"Pune",phone:"",email:"",currency:"INR"},allocations:[{amount:800,invoiceNo:"SWP-INV-000001",description:"Study membership"}],refunds:[]};
describe("receipt generation",()=>{it("contains payment details and escapes unsafe member text",()=>{const html=receiptHtml(receipt);expect(html).toContain("SWP-RCPT-000001");expect(html).toContain("INR 800.00");expect(html).toContain("Karan &lt;Bhor&gt;");expect(html).not.toContain("Karan <Bhor>")})});
