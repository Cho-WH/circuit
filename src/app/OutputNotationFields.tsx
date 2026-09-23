interface Props { properties:Record<string,string|number|boolean>;label:string|null|undefined;value:string|null|undefined;onChange:(values:Record<string,string|number|boolean>)=>void }
export function OutputNotationFields({properties,label,value,onChange}:Props) {
  return <>
{[{prefix:'label',label:'기호·이름',value:label},{prefix:'answer',label:'값',value:value}].map(({prefix,label,value})=>{
      const visible=properties[prefix+'Visible']!==false&&properties[prefix+'Display']!=='hidden';
      const blank=properties[prefix+'Blank']===true||properties[prefix+'Display']==='blank';
      return <div className="output-notation" key={prefix}><div className="output-field-heading"><label htmlFor={'output-'+prefix}>{label}</label><input role="switch" aria-label={label+' 표시'} type="checkbox" checked={visible} onChange={e=>onChange({[prefix+'Visible']:e.target.checked,...(properties[prefix+'Display']==='hidden'?{[prefix+'Display']:properties[prefix+'Text']===undefined?'value':'custom'}:{})})}/></div>
        <input id={'output-'+prefix} aria-label={label+' 출력 문자'} value={String(properties[prefix+'Text']??(properties[prefix+'Display']==='?'?'?':value??''))} maxLength={160} onChange={e=>onChange({[prefix+'Text']:e.target.value,[prefix+'Display']:'custom'})}/>
        <label className="check-label"><input type="checkbox" checked={blank} onChange={e=>onChange({[prefix+'Blank']:e.target.checked,...(properties[prefix+'Display']==='blank'?{[prefix+'Display']:properties[prefix+'Text']===undefined?'value':'custom'}:{})})}/>빈칸 □</label>
        <button className="output-reset" onClick={()=>onChange({[prefix+'OffsetX']:0,[prefix+'OffsetY']:0})}>위치 초기화</button>
      </div>;
    })}
</>;
}
