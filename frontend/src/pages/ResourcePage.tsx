import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { api } from "../lib/api";
import { Card, Empty, PageHeading, Pagination, SearchBox } from "../components/ui";

type Column={label:string;value:(row:any)=>React.ReactNode};
type Props={title:string;description:string;endpoint:string;columns:Column[];action?:React.ReactNode;rowAction?:(row:any)=>React.ReactNode};
type FilterKey="status"|"type"|"method"|"category"|"active";

const filterKeys:FilterKey[]=["status","type","method","category","active"];
const dateKeys=["createdAt","paidAt","expenseDate","checkInAt","startDate","reservedAt","issuedAt","dueAt"];
const labelFor=(value:unknown)=>{
  if(typeof value==="boolean")return value?"Active":"Inactive";
  const text=String(value).replaceAll("_"," ");
  if(text==="BOOK")return "Class";
  if(text==="BOTH"||text==="COMBINED")return "Study + Class";
  return text.toLowerCase().replace(/\b\w/g,(letter)=>letter.toUpperCase());
};
const fieldLabel=(value:string)=>value.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/^./,(letter)=>letter.toUpperCase());
const withPageSize=(endpoint:string)=>`${endpoint}${endpoint.includes("?")?"&":"?"}pageSize=100`;

export function ResourcePage({title,description,endpoint,columns,action,rowAction}:Props){
  const[search,setSearch]=useState("");
  const[filters,setFilters]=useState<Partial<Record<FilterKey,string>>>({});
  const[fromDate,setFromDate]=useState("");
  const[toDate,setToDate]=useState("");
  const[page,setPage]=useState(1);
  const[pageSize,setPageSize]=useState(20);
  const{data,isLoading,error}=useQuery({queryKey:[endpoint],queryFn:()=>api<any[]>(withPageSize(endpoint))});
  const source=data??[];
  const availableFilters=useMemo(()=>filterKeys.map(key=>({key,options:[...new Set(source.map(row=>row?.[key]).filter(value=>value!==undefined&&value!==null).map(String))]})).filter(filter=>filter.options.length>1),[source]);
  const dateKey=useMemo(()=>dateKeys.find(key=>source.some(row=>row?.[key]))??null,[source]);
  const rows=useMemo(()=>source.filter(row=>{
    if(search&&!JSON.stringify(row).toLowerCase().includes(search.toLowerCase()))return false;
    if(availableFilters.some(({key})=>filters[key]!==undefined&&filters[key]!==""&&String(row?.[key])!==filters[key]))return false;
    if(dateKey&&(fromDate||toDate)){
      const value=String(row?.[dateKey]??"").slice(0,10);
      if(!value||(fromDate&&value<fromDate)||(toDate&&value>toDate))return false;
    }
    return true;
  }),[source,search,availableFilters,filters,dateKey,fromDate,toDate]);
  const hasFilters=Boolean(search||fromDate||toDate||Object.values(filters).some(Boolean));
  const pages=Math.max(1,Math.ceil(rows.length/pageSize));
  const currentPage=Math.min(page,pages);
  const pagedRows=rows.slice((currentPage-1)*pageSize,currentPage*pageSize);
  const clearFilters=()=>{setSearch("");setFilters({});setFromDate("");setToDate("");setPage(1)};
  return <><PageHeading title={title} description={description} action={action}/><Card>
    <div className="border-b border-[var(--border)] p-4">
      <div className="flex flex-nowrap items-center gap-2 overflow-hidden">
        <div className="min-w-0 flex-1 basis-[220px]"><SearchBox value={search} onChange={value=>{setSearch(value);setPage(1)}} placeholder={`Search ${title.toLowerCase()}…`}/></div>
        {availableFilters.map(({key,options})=><select key={key} aria-label={`Filter by ${fieldLabel(key)}`} className="input !w-[120px] shrink-0" value={filters[key]??""} onChange={event=>{setFilters(current=>({...current,[key]:event.target.value}));setPage(1)}}><option value="">All {fieldLabel(key).toLowerCase()}</option>{options.map(option=><option key={option} value={option}>{labelFor(option)}</option>)}</select>)}
        {dateKey&&<><label className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-[var(--muted)]"><span>From</span><input aria-label={`${fieldLabel(dateKey)} from`} className="input !w-[115px]" type="date" value={fromDate} max={toDate||undefined} onChange={event=>{setFromDate(event.target.value);setPage(1)}}/></label><label className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-[var(--muted)]"><span>To</span><input aria-label={`${fieldLabel(dateKey)} to`} className="input !w-[115px]" type="date" value={toDate} min={fromDate||undefined} onChange={event=>{setToDate(event.target.value);setPage(1)}}/></label></>}
        {hasFilters&&<button type="button" className="btn btn-ghost shrink-0 whitespace-nowrap px-3" onClick={clearFilters}><RotateCcw size={15}/> Clear</button>}
      </div>
      <p className="mt-3 text-xs text-[var(--muted)]">Showing <b className="text-[var(--text)]">{rows.length}</b> of {source.length} records{dateKey?` · filtered by ${fieldLabel(dateKey).toLowerCase()}`:""}</p>
    </div>
    <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[700px] text-left"><thead><tr className="border-b border-[var(--border)] text-xs uppercase tracking-wider text-[var(--muted)]">{columns.map(c=><th className="px-5 py-3" key={c.label}>{c.label}</th>)}{rowAction&&<th className="px-5 py-3 text-right">Actions</th>}</tr></thead><tbody className="divide-y divide-[var(--border)]">{pagedRows.map((row,i)=><tr key={row.id??i} className="hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20">{columns.map(c=><td className="px-5 py-4 text-sm" key={c.label}>{c.value(row)}</td>)}{rowAction&&<td className="px-5 py-4 text-right">{rowAction(row)}</td>}</tr>)}</tbody></table></div>
    <div className="divide-y divide-[var(--border)] md:hidden">{pagedRows.map((row,i)=><article key={row.id??i} className="space-y-3 p-4">{columns.map((c,index)=><div key={c.label} className={index===0?"":"flex items-start justify-between gap-4"}><div className={index===0?"hidden":"text-xs font-bold uppercase tracking-wider text-[var(--muted)]"}>{c.label}</div><div className={index===0?"text-base":"text-right text-sm"}>{c.value(row)}</div></div>)}{rowAction&&<div className="border-t border-[var(--border)] pt-3 text-right">{rowAction(row)}</div>}</article>)}</div>
    {isLoading&&<div className="p-12 text-center text-sm text-[var(--muted)]">Loading live records…</div>}{error&&<div className="p-12 text-center text-sm text-rose-600">{error.message}</div>}{!isLoading&&!rows.length&&<Empty title={hasFilters?"No matching records":`No ${title.toLowerCase()} yet`} message={hasFilters?"Try changing or clearing the filters.":"New records will appear here."}/>}<Pagination page={currentPage} pageSize={pageSize} total={rows.length} onPageChange={setPage} onPageSizeChange={size=>{setPageSize(size);setPage(1)}}/></Card></>
}
export const badge=(value:string)=><span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">{value.replaceAll("_"," ")}</span>;
export const money=(value:string|number)=>new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR"}).format(Number(value));
