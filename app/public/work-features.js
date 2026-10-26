/* Shared web workflows; the mobile client can use the same resource/review APIs. */
const boardManager = () => !!me?.is_admin || boardData?.board?.role === 'manager';
const featureEl = (tag, text, className) => { const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e; };
function featureButton(text, action, className='btn') {const b=featureEl('button',text,className);b.type='button';b.onclick=action;return b;}
function featureSelect(items, value) {const s=featureEl('select',undefined,'field');for(const [v,t] of items){const o=featureEl('option',t);o.value=v;s.appendChild(o);}s.value=value??'';return s;}
function featureInput(type,value,label) {const i=featureEl('input');i.type=type;i.value=value || '';if(label)i.setAttribute('aria-label',label);return i;}
function featureField(label,input) {const wrap=featureEl('label',label);wrap.appendChild(input);return wrap;}
function attachFeatureDialog(id,title) {const d=featureEl('dialog');d.id=id;d.append(featureEl('h3',title));document.body.appendChild(d);return d;}
const transferDialog=attachFeatureDialog('transferDialog','Di chuyển / Sao chép thẻ');
const teamsDialog=attachFeatureDialog('teamsDialog','Quản lý team');
const overviewDialog=attachFeatureDialog('overviewDialog','Tổng quan công việc');
$('overviewBtn').onclick=async()=>{
  const data=await api('/overview'),d=overviewDialog;d.innerHTML='';d.appendChild(featureEl('h3','Tổng quan công việc trong phạm vi được cấp quyền'));
  const summary=featureEl('div',undefined,'overview-stats');
  for(const [key,name] of [['boards','Bảng'],['total','Công việc'],['pending','Chờ duyệt'],['changes_requested','Cần sửa'],['overdue','Quá hạn'],['done','Hoàn thành']]){const box=featureEl('div');box.append(featureEl('strong',String(data.stats[key])),featureEl('span',name));summary.appendChild(box);}d.appendChild(summary);
  for(const team of data.teams)d.appendChild(featureEl('p',`${team.name}: ${team.total} việc · ${team.pending} chờ duyệt · ${team.overdue} quá hạn · ${team.done} hoàn thành`));
  d.appendChild(featureEl('h4','Công việc chờ duyệt'));
  for(const card of data.cards.filter(c=>c.approval_state==='pending'))d.appendChild(featureButton(`${card.title} — ${card.board_title}`,()=>{d.close();location.hash='#c/'+card.id;applyHash();}));
  d.appendChild(featureButton('Đóng',()=>d.close()));d.showModal();
};
async function exportBoardJson() {
  const res=await fetch(`/api/boards/${currentBoardId}/export.json`,{headers:{Authorization:'Bearer '+token}});
  if(!res.ok){toast('Không xuất được bảng');return;}const blob=await res.blob(),a=featureEl('a');a.href=URL.createObjectURL(blob);a.download=boardData.board.title+'.json';a.click();URL.revokeObjectURL(a.href);
}
function resetBoardFilters() {
  filter.text='';filter.members.clear();filter.labels.clear();filter.due=null;filter.status=null;filter.activity=null;filter.memberMode='any';filter.labelMode='any';filter.hideEmpty=false;$('filterText').value='';
}
$('filterClear').onclick=()=>{resetBoardFilters();render();};
const filterCount=featureEl('p');filterCount.id='filterCount';$('filterText').after(filterCount);
const memberMode=featureSelect([['any','Có bất kỳ thành viên đã chọn'],['all','Có tất cả thành viên đã chọn']],'any');memberMode.setAttribute('aria-label','Cách khớp thành viên');memberMode.onchange=()=>{filter.memberMode=memberMode.value;render();};$('filterMembers').before(memberMode);
const labelMode=featureSelect([['any','Có bất kỳ nhãn đã chọn'],['all','Có tất cả nhãn đã chọn']],'any');labelMode.setAttribute('aria-label','Cách khớp nhãn');labelMode.onchange=()=>{filter.labelMode=labelMode.value;render();};$('filterLabels').before(labelMode);
const activityFilter=featureSelect([['','Mọi thời điểm hoạt động'],['7','Có hoạt động trong 7 ngày'],['14','Có hoạt động trong 14 ngày'],['28','Có hoạt động trong 28 ngày'],['none28','Không hoạt động trong 28 ngày']],'');activityFilter.setAttribute('aria-label','Lọc theo hoạt động');activityFilter.onchange=()=>{filter.activity=activityFilter.value || null;render();};
const hideEmpty=featureInput('checkbox');hideEmpty.onchange=()=>{filter.hideEmpty=hideEmpty.checked;render();};$('filterClear').before(activityFilter,featureField('Ẩn cột không có kết quả',hideEmpty));
function updateFilterSummary() {
  if(!boardData)return;filterCount.textContent=`${boardData.cards.filter(cardMatchesFilter).length}/${boardData.cards.length} thẻ phù hợp`;
  memberMode.value=filter.memberMode;labelMode.value=filter.labelMode;activityFilter.value=filter.activity || '';hideEmpty.checked=filter.hideEmpty;
  $('filterBtn').classList.toggle('on',!!filterActive());
}
async function refreshBoardAccess() {
  allBoards=(await api('/boards')).boards;
  if(currentBoardId && !allBoards.some(b=>b.id===currentBoardId)) {
    editingCard=null;document.querySelectorAll('dialog[open]').forEach(d=>d.close());
    for(const id of ['boardView','calendarView','tableView'])$(id).innerHTML='';
    await showBoards();toast('Quyền truy cập bảng đã thay đổi');
  } else if(currentBoardId) await loadBoard(currentBoardId,true);
  else await loadBoards();
}

async function saveChecklist() {
  for(const id of deletedChecklist) await api('/checklist/'+id,{method:'DELETE'});
  deletedChecklist=[];
  for(const item of editChecklist) {
    if(!item.text.trim()) continue;
    const body={text:item.text.trim(),checked:item.checked,group_id:item.group_id,user_id:item.user_id || null,due_date:item.due_date || '',due_time:item.due_time || ''};
    if(item.id) await api('/checklist/'+item.id,{method:'PATCH',body});
    else item.id=(await api(`/cards/${editingCard.id}/checklist`,{method:'POST',body})).id;
  }
}
async function saveCurrentCard(close=true) {
  if(!editingCard) return false;
  const id=editingCard.id,saveButton=$('cardForm').querySelector('[value="save"]');saveButton.disabled=true;
  try {
    await saveChecklist();
    for(const input of document.querySelectorAll('#fFields .cf-input')) {
      const value=input.type==='checkbox'?(input.checked?'1':'0'):input.value;
      if(value!==input.dataset.orig) {await api(`/cards/${id}/field/${input.dataset.fieldId}`,{method:'PUT',body:{value}});input.dataset.orig=value;}
    }
    const label_ids=[...document.querySelectorAll('#fLabels .swatch.on')].map(b=>Number(b.dataset.labelId));
    const user_ids=[...document.querySelectorAll('#fMembers .chip.on')].map(b=>Number(b.dataset.userId));
    await api(`/cards/${id}/labels`,{method:'PUT',body:{label_ids}});
    await api(`/cards/${id}/members`,{method:'PUT',body:{user_ids}});
    const cover=[...$('fCover').children].find(b=>b.classList.contains('on'))?.dataset.color || '';
    // Complete last, so a recurring card's checklist reset cannot be overwritten by this form.
    const result=await api('/cards/'+id,{method:'PATCH',body:{title:$('fTitle').value.trim() || editingCard.title,description:$('fDesc').value,due_date:$('fDue').value,start_date:$('fStart').value,due_time:$('fDueTime').value,recur:$('fRecur').value,remind:$('fRemind').value,due_complete:$('fDueDone').checked,cover}});
    editingCard=result.card;
    if(close) {editingCard=null;$('cardDialog').close();toast('Đã lưu công việc');}
    else applyCardDates(result.card);
    return true;
  } catch {return false;} finally {saveButton.disabled=false;}
}

function applyCardDates(card){for(const [id,key] of [['fDue','due_date'],['fStart','start_date'],['fDueTime','due_time'],['fRecur','recur'],['fRemind','remind']])$(id).value=card[key] || '';$('fDueDone').checked=!!card.due_complete;$('fDueDone').disabled=!!boardData.board.approval_required && !card.due_complete;}
async function loadReview(cardId) {
  const wrap=$('fReview');wrap.textContent='Đang tải trạng thái duyệt…';
  const data=await api(`/cards/${cardId}/review`);if(editingCard?.id!==cardId)return;
  wrap.innerHTML='';
  const states={in_progress:'Đang thực hiện',pending:'⏳ Chờ duyệt',changes_requested:'↩ Yêu cầu chỉnh sửa',approved:'✓ Đã duyệt hoàn thành'};
  wrap.appendChild(featureEl('strong',states[data.state] || data.state));
  const reviewer=users.find(u=>u.id===data.reviewer_id);
  if(reviewer)wrap.appendChild(featureEl('p','Người duyệt: '+reviewer.name));
  if(boardManager()) {
    const choices=[['','Chọn người duyệt'],...data.candidates.map(u=>[u.id,u.name+(u.is_admin?' — Giám đốc / quản trị':' — Quản lý')])];
    const select=featureSelect(choices,data.reviewer_id);
    select.setAttribute('aria-label','Người duyệt công việc');
    select.onchange=async()=>{if(select.value){await api(`/cards/${cardId}/reviewer`,{method:'PUT',body:{reviewer_id:Number(select.value)}});await loadReview(cardId);}};
    wrap.appendChild(select);
  }
  const action=async(type,note='')=>{
    if(type==='submit' && !await saveCurrentCard(false))return;
    await api(`/cards/${cardId}/review`,{method:'POST',body:{action:type,note}});
    boardData=await api('/boards/'+currentBoardId);editingCard=boardData.cards.find(c=>c.id===cardId);
    applyCardDates(editingCard);
    renderChecklistEditor(checklistOf(cardId).map(i=>({...i,checked:!!i.checked})));
    await loadReview(cardId);render();
    toast(type==='submit'?'Đã gửi duyệt':type==='approve'?'Đã duyệt hoàn thành':'Đã yêu cầu chỉnh sửa');
  };
  if(data.can_submit && !editingCard.due_complete && data.state!=='pending') wrap.appendChild(featureButton('Gửi duyệt',()=>action('submit'),'btn btn-primary'));
  if(data.state==='pending' && data.submitted_by!==me.id && (data.reviewer_id===me.id || me.is_admin) && data.candidates.some(u=>u.id===me.id)) {
    wrap.appendChild(featureButton('Duyệt hoàn thành',()=>action('approve'),'btn btn-primary'));
    wrap.appendChild(featureButton('Yêu cầu sửa',()=>{const note=prompt('Nội dung cần chỉnh sửa:');if(note?.trim())action('request_changes',note.trim());}));
  }
  if(data.events.length) {
    const history=featureEl('details'),summary=featureEl('summary','Lịch sử duyệt');history.appendChild(summary);
    const names={submit:'Gửi duyệt',approve:'Duyệt hoàn thành',request_changes:'Yêu cầu chỉnh sửa'};
    for(const e of data.events)history.appendChild(featureEl('p',`${e.author || 'Hệ thống'} · ${names[e.action] || e.action}${e.note?' — '+e.note:''}`));
    wrap.appendChild(history);
  }
}

function renderChecklistEditor(items) {
  editChecklist=items;const wrap=$('fChecklist');wrap.innerHTML='';
  const groups=(boardData.checklistGroups || []).filter(g=>g.card_id===editingCard?.id);
  const rendered=groups.length?groups:[{id:null,title:'Checklist'}];
  for(const group of rendered) {
    const section=featureEl('section',undefined,'checklist-group'),head=featureEl('div',undefined,'feature-row');
    const groupItems=editChecklist.filter(i=>(i.group_id || null)===(group.id || null));
    head.appendChild(featureEl('strong',`${group.title} · ${groupItems.filter(i=>i.checked).length}/${groupItems.length}`));
    if(group.id) {
      head.appendChild(featureButton('Đổi tên',async()=>{const title=prompt('Tên checklist:',group.title);if(title?.trim()){await api('/checklists/'+group.id,{method:'PATCH',body:{title:title.trim()}});group.title=title.trim();renderChecklistEditor(editChecklist);}},'ghost'));
      head.appendChild(featureButton('Xóa',async()=>{if(!confirm('Xóa checklist này cùng các việc con?'))return;await api('/checklists/'+group.id,{method:'DELETE'});boardData.checklistGroups=boardData.checklistGroups.filter(g=>g.id!==group.id);renderChecklistEditor(editChecklist.filter(i=>i.group_id!==group.id));},'ghost'));
    }
    section.appendChild(head);
    for(const item of groupItems) {
      const row=featureEl('div',undefined,'checklist-item advanced'),cb=featureInput('checkbox');cb.checked=!!item.checked;cb.setAttribute('aria-label','Hoàn thành việc con: '+item.text);cb.onchange=()=>{item.checked=cb.checked;head.querySelector('strong').textContent=`${group.title} · ${groupItems.filter(i=>i.checked).length}/${groupItems.length}`;};
      const text=featureInput('text',item.text,'Nội dung việc con');text.oninput=()=>item.text=text.value;
      const members=featureSelect([['','Chưa giao'],...(boardData.eligibleMembers || []).filter(u=>boardManager() || u.id===me.id || u.id===item.user_id).map(u=>[u.id,u.name])],item.user_id);members.setAttribute('aria-label','Người phụ trách việc con');members.disabled=!boardManager() && !!item.user_id && item.user_id!==me.id;
      members.onchange=()=>item.user_id=members.value?Number(members.value):null;
      const date=featureInput('date',item.due_date,'Hạn việc con'),time=featureInput('time',item.due_time,'Giờ hạn việc con');date.onchange=()=>item.due_date=date.value;time.onchange=()=>item.due_time=time.value;
      const convert=featureButton('↗ Thành thẻ',async()=>{
        if(!await saveCurrentCard(false))return;
        const r=await api('/checklist/'+item.id+'/convert',{method:'POST'});boardData=await api('/boards/'+currentBoardId);
        $('cardDialog').close();openCardDialog(boardData.cards.find(c=>c.id===r.id));render();
      },'ghost');
      const remove=featureButton('✕',()=>{if(item.id)deletedChecklist.push(item.id);renderChecklistEditor(editChecklist.filter(i=>i!==item));},'ghost');
      row.append(cb,text,members,date,time,convert,remove);section.appendChild(row);
    }
    section.appendChild(featureButton('+ Việc con',()=>renderChecklistEditor([...editChecklist,{text:'',checked:false,group_id:group.id}]),'ghost'));
    wrap.appendChild(section);
  }
}
$('addCheck').onclick=()=>renderChecklistEditor([...editChecklist,{text:'',checked:false,group_id:(boardData.checklistGroups || []).find(g=>g.card_id===editingCard.id)?.id || null}]);
$('addChecklistGroup').onclick=async()=>{
  if(!editingCard)return;const title=prompt('Tên checklist mới:','Checklist');if(!title?.trim())return;
  if(!await saveCurrentCard(false))return;
  await api(`/cards/${editingCard.id}/checklists`,{method:'POST',body:{title:title.trim()}});
  boardData=await api('/boards/'+currentBoardId);renderChecklistEditor(checklistOf(editingCard.id).map(i=>({...i,checked:!!i.checked})));
};

async function loadComments(cardId) {
  const {comments}=await api(`/cards/${cardId}/comments`);if(editingCard?.id!==cardId)return;
  const wrap=$('fComments');wrap.innerHTML='';
  for(const cm of comments) {
    const row=featureEl('div',undefined,'comment');row.id='comment-'+cm.id;
    row.append(featureEl('div',`${cm.author || 'Người dùng đã xóa'} · ${cm.created_at} UTC${cm.edited_at?' · đã sửa':''}`,'who'),featureEl('div',cm.text));
    const actions=featureEl('div',undefined,'feature-row');
    if(cm.user_id===me.id)actions.appendChild(featureButton('Sửa',async()=>{const text=prompt('Sửa bình luận:',cm.text);if(text?.trim()){await api('/comments/'+cm.id,{method:'PATCH',body:{text}});loadComments(cardId);}},'ghost'));
    if(cm.user_id===me.id || boardManager())actions.appendChild(featureButton('Xóa',async()=>{if(confirm('Xóa bình luận này?')){await api('/comments/'+cm.id,{method:'DELETE'});loadComments(cardId);}},'ghost'));
    for(const emoji of ['👍','✅','❤️','👀','🎉']) {
      const reaction=cm.reactions.find(r=>r.emoji===emoji);
      actions.appendChild(featureButton(emoji+(reaction?' '+reaction.count:''),async()=>{await api('/comments/'+cm.id+'/reactions',{method:'POST',body:{emoji}});loadComments(cardId);},'chip'+(reaction?.mine?' on':'')));
    }
    row.appendChild(actions);wrap.appendChild(row);
  }
}

async function openTransferDialog(card,mode) {
  const d=transferDialog;d.innerHTML='';d.appendChild(featureEl('h3',mode==='copy'?'Sao chép thẻ':'Di chuyển thẻ'));
  const form=featureEl('form'),title=featureInput('text',card.title,'Tên thẻ sao chép');
  if(mode==='copy')form.appendChild(featureField('Tiêu đề',title));
  allBoards=(await api('/boards')).boards;
  const boards=allBoards.filter(b=>!b.closed && (b.id===currentBoardId || (boardManager() && b.role==='manager')));
  const bs=featureSelect(boards.map(b=>[b.id,b.title]),currentBoardId),ls=featureSelect([]);bs.setAttribute('aria-label','Bảng đích');ls.setAttribute('aria-label','Cột đích');
  const refresh=async()=>{const data=await api('/boards/'+bs.value);ls.innerHTML='';for(const list of data.lists){const o=featureEl('option',list.title);o.value=list.id;ls.appendChild(o);}if(Number(bs.value)===currentBoardId)ls.value=card.list_id;};
  bs.onchange=refresh;form.append(featureField('Bảng',bs),featureField('Cột',ls));
  const keep={};if(mode==='copy')for(const [key,label] of [['labels','Giữ nhãn'],['members','Giữ người nhận việc (cả việc con)'],['fields','Giữ trường tùy chỉnh'],['checklists','Giữ checklist'],['attachments','Giữ đính kèm']]){const cb=featureInput('checkbox');cb.checked=true;keep[key]=cb;form.appendChild(featureField(label,cb));}
  const submit=featureEl('button',mode==='copy'?'Tạo bản sao':'Di chuyển','btn btn-primary');submit.type='submit';
  form.append(submit,featureButton('Hủy',()=>d.close()));
  form.onsubmit=async e=>{e.preventDefault();if(!ls.value)return;submit.disabled=true;
    try {
      const body={list_id:Number(ls.value)};if(mode==='copy'){body.title=title.value;for(const [key,cb] of Object.entries(keep))body[key]=cb.checked;await api(`/cards/${card.id}/copy`,{method:'POST',body});}
      else await api('/cards/'+card.id,{method:'PATCH',body});
      d.close();closeMiniMenu();if($('cardDialog').open){editingCard=null;$('cardDialog').close();}await loadBoard(currentBoardId,true);toast(mode==='copy'?'Đã sao chép thẻ và dữ liệu đã chọn':'Đã di chuyển thẻ');
    } finally {submit.disabled=false;}
  };
  d.appendChild(form);d.showModal();await refresh();
}

function openQuickEdit(card,anchor) {
  closeMiniMenu();const menu=featureEl('div',undefined,'minimenu quick-edit'),r=anchor.getBoundingClientRect();
  menu.style.left=Math.max(8,Math.min(r.left,innerWidth-340))+'px';menu.style.top=Math.max(8,Math.min(r.top,innerHeight-480))+'px';
  const title=featureInput('text',card.title,'Sửa nhanh tiêu đề'),date=featureInput('date',card.due_date,'Sửa nhanh hạn'),time=featureInput('time',card.due_time,'Sửa nhanh giờ hạn');
  menu.append(featureEl('h4','Sửa nhanh thẻ'),title,featureField('Hạn',date),featureField('Giờ',time));
  const labels=featureEl('div',undefined,'feature-row'),selected=new Set(labelsOf(card.id));
  for(const l of boardData.labels){const b=featureButton(l.name || 'Nhãn',()=>{selected.has(l.id)?selected.delete(l.id):selected.add(l.id);b.classList.toggle('on',selected.has(l.id));},'chip'+(selected.has(l.id)?' on':''));b.style.borderColor=l.color;labels.appendChild(b);}menu.appendChild(labels);
  menu.appendChild(featureButton('Lưu thay đổi',async()=>{await api('/cards/'+card.id,{method:'PATCH',body:{title:title.value,due_date:date.value,due_time:time.value}});await api(`/cards/${card.id}/labels`,{method:'PUT',body:{label_ids:[...selected]}});closeMiniMenu();await loadBoard(currentBoardId,true);},'btn btn-primary'));
  menu.append(featureButton('Mở chi tiết / Thành viên',()=>{closeMiniMenu();openCardDialog(card);}),featureButton('Di chuyển',()=>openTransferDialog(card,'move')),featureButton('Sao chép',()=>openTransferDialog(card,'copy')),featureButton('Lưu trữ',async()=>{await api('/cards/'+card.id,{method:'PATCH',body:{archived:true}});closeMiniMenu();toast('Đã lưu trữ — khôi phục trong mục lưu trữ');}),featureButton('Đóng',closeMiniMenu));
  document.body.appendChild(menu);title.focus();
}
function addListActions(list,mi) {
  mi(boardData.myListWatches?.includes(list.id)?'👁 Bỏ theo dõi cột':'👁 Theo dõi cột',async()=>{const r=await api(`/lists/${list.id}/watch`,{method:'POST'});boardData.myListWatches=(boardData.myListWatches || []).filter(id=>id!==list.id);if(r.watching)boardData.myListWatches.push(list.id);toast(r.watching?'Đã theo dõi cột':'Đã bỏ theo dõi');});
  if(!boardManager())return;
  mi('⎘ Sao chép cột',async()=>{const title=prompt('Tên cột sao chép:',list.title+' (bản sao)');if(title?.trim()){await api(`/lists/${list.id}/copy`,{method:'POST',body:{title}});await loadBoard(currentBoardId,true);}});
  mi('⇄ Di chuyển tất cả thẻ',()=>openMoveAllDialog(list));
  mi('🗃 Lưu trữ tất cả thẻ',async()=>{if(confirm('Lưu trữ toàn bộ thẻ trong cột? Có thể khôi phục từng thẻ.')){await api(`/lists/${list.id}/archive-cards`,{method:'POST'});await loadBoard(currentBoardId,true);}});
}
function openMoveAllDialog(list) {
  const d=transferDialog;d.innerHTML='';d.appendChild(featureEl('h3','Di chuyển tất cả thẻ'));
  const s=featureSelect(boardData.lists.filter(l=>l.id!==list.id).map(l=>[l.id,l.title]));s.setAttribute('aria-label','Cột nhận tất cả thẻ');
  d.append(s,featureButton('Di chuyển',async()=>{if(!s.value)return;await api(`/lists/${list.id}/move-cards`,{method:'POST',body:{list_id:Number(s.value)}});d.close();await loadBoard(currentBoardId,true);}),featureButton('Hủy',()=>d.close()));d.showModal();
}

async function renderBoardAccessPanel() {
  const p=panelFrame('Phân quyền & team','main'),manage=boardManager();
  p.appendChild(featureEl('p','Chỉ người được cấp quyền mới truy cập bảng. Quản lý được giao việc và quản lý thành viên; leader quản lý các bảng được giám đốc gắn với team của mình.'));
  const selections=[];
  for(const u of users.filter(u=>!u.disabled)) {
    const existing=(boardData.boardMemberRoles || []).find(m=>m.user_id===u.id)?.role || '';
    const select=featureSelect([['','Chưa cấp quyền'],['member','Thành viên'],['manager','Quản lý bảng']],existing);
    select.disabled=!manage;select.setAttribute('aria-label','Quyền bảng của '+u.name);selections.push([u.id,select]);
    p.appendChild(featureField(u.name+(u.is_admin?' (Giám đốc / quản trị)':''),select));
  }
  if(manage)p.appendChild(featureButton('Lưu phân quyền',async()=>{const members=selections.filter(([,s])=>s.value).map(([user_id,s])=>({user_id,role:s.value}));if(!me.is_admin && !members.some(m=>m.user_id===me.id)){members.push({user_id:me.id,role:'manager'});}await api(`/boards/${currentBoardId}/members`,{method:'PUT',body:{members}});await loadBoard(currentBoardId,true);await renderBoardAccessPanel();toast('Đã lưu phân quyền');},'btn btn-primary'));
  if(manage) {
    p.appendChild(featureEl('h4','Cột của quy trình duyệt'));const selections={};
    for(const [field,label] of [['review_list_id','Khi gửi duyệt'],['done_list_id','Khi duyệt hoàn thành'],['changes_list_id','Khi yêu cầu sửa']]) {
      const select=featureSelect([['','Giữ nguyên cột'],...boardData.lists.map(l=>[l.id,l.title])],boardData.board[field]);selections[field]=select;p.appendChild(featureField(label,select));
    }
    p.appendChild(featureButton('Lưu cột quy trình',async()=>{const body=Object.fromEntries(Object.entries(selections).map(([key,s])=>[key,Number(s.value) || null]));await api(`/boards/${currentBoardId}/workflow`,{method:'PUT',body});await loadBoard(currentBoardId,true);toast('Đã lưu quy trình duyệt');}));
  }
  if(me.is_admin) {
    const {teams}=await api('/teams'),select=featureSelect([['','Chưa gắn team'],...teams.map(t=>[t.id,t.name])],boardData.board.team_id);
    p.appendChild(featureField('Team phụ trách bảng',select));
    p.append(featureButton('Lưu team phụ trách',async()=>{await api(`/boards/${currentBoardId}/team`,{method:'PUT',body:{team_id:Number(select.value) || null}});await loadBoard(currentBoardId,true);toast('Đã gắn team');}),featureButton('Quản lý các team',openTeamsDialog));
  }
}
async function openTeamsDialog() {
  const d=teamsDialog;d.innerHTML='';d.appendChild(featureEl('h3','Các team trong công ty'));
  const {teams}=await api('/teams');const name=featureInput('text','','Tên team mới');
  d.append(name,featureButton('Thêm team',async()=>{if(!name.value.trim())return;await api('/teams',{method:'POST',body:{name:name.value.trim()}});openTeamsDialog();},'btn btn-primary'));
  for(const team of teams) {
    const section=featureEl('section',undefined,'checklist-group');section.appendChild(featureEl('h4',team.name));const selections=[];
    for(const u of users.filter(u=>!u.disabled)) {
      const select=featureSelect([['','Không thuộc team'],['member','Nhân viên'],['leader','Leader']],team.members.find(m=>m.user_id===u.id)?.role || '');selections.push([u.id,select]);section.appendChild(featureField(u.name,select));
    }
    section.appendChild(featureButton('Lưu thành viên '+team.name,async()=>{const members=selections.filter(([,s])=>s.value).map(([user_id,s])=>({user_id,role:s.value}));await api(`/teams/${team.id}/members`,{method:'PUT',body:{members}});toast('Đã lưu team');}));d.appendChild(section);
  }
  d.appendChild(featureButton('Đóng',()=>d.close()));if(!d.open)d.showModal();
}
const teamButton=featureButton('Quản lý team',openTeamsDialog);$('adminDialog').prepend(teamButton);

async function openLabelDialog(label) {
  if(!boardManager())return;const selected=[...document.querySelectorAll('#fLabels .swatch.on')].map(e=>Number(e.dataset.labelId));
  const d=transferDialog;d.innerHTML='';d.appendChild(featureEl('h3',label?'Chỉnh sửa nhãn':'Tạo nhãn'));
  const form=featureEl('form'),name=featureInput('text',label?.name,'Tên nhãn'),color=featureInput('color',label?.color || '#61bd4f','Màu nhãn'),save=featureEl('button','Lưu nhãn','btn btn-primary');save.type='submit';
  form.append(featureField('Tên',name),featureField('Màu',color),save,featureButton('Hủy',()=>d.close()));
  form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{const result=await api(label?'/labels/'+label.id:`/boards/${currentBoardId}/labels`,{method:label?'PATCH':'POST',body:{name:name.value.trim(),color:color.value}});if(!label)selected.push(result.id);boardData=await api('/boards/'+currentBoardId);renderLabelEditor(editingCard);for(const b of document.querySelectorAll('#fLabels .swatch'))b.classList.toggle('on',selected.includes(Number(b.dataset.labelId)));render();d.close();}finally{save.disabled=false;}};
  d.appendChild(form);d.showModal();
}
$('addLabelBtn').onclick=()=>openLabelDialog(null);
const labelSearch=featureInput('search','','Tìm nhãn trong thẻ');labelSearch.placeholder='Tìm nhãn…';labelSearch.oninput=()=>{for(const row of $('fLabels').children)row.hidden=!row.textContent.toLocaleLowerCase().includes(labelSearch.value.toLocaleLowerCase());};$('fLabels').before(labelSearch);
function editFieldDefinition(field) {
  const d=transferDialog;d.innerHTML='';d.appendChild(featureEl('h3','Chỉnh sửa trường tùy chỉnh'));
  const name=featureInput('text',field.name,'Tên trường'),options=featureInput('text',JSON.parse(field.options || '[]').join(', '),'Các lựa chọn');d.appendChild(featureField('Tên',name));if(field.type==='select')d.appendChild(featureField('Các lựa chọn, cách nhau bằng dấu phẩy',options));
  d.append(featureButton('Lưu trường',async()=>{await api('/fields/'+field.id,{method:'PATCH',body:{name:name.value,options:field.type==='select'?options.value.split(',').map(v=>v.trim()).filter(Boolean):[]}});d.close();await loadBoard(currentBoardId,true);openBoardMenu('fields');}),featureButton('Hủy',()=>d.close()));d.showModal();
}

// A small Markdown toolbar keeps the stored description portable to the iOS client.
const descriptionTools=featureEl('div',undefined,'feature-row');
for(const [label,before,after] of [['Đậm','**','**'],['Nghiêng','*','*'],['Danh sách','\n- ',''],['Liên kết','[','](https://)']]) {
  descriptionTools.appendChild(featureButton(label,()=>{const field=$('fDesc'),start=field.selectionStart,end=field.selectionEnd;field.setRangeText(before+field.value.slice(start,end)+after,start,end,'end');field.focus();},'ghost'));
}
const preview=featureEl('div',undefined,'description-preview hidden');
descriptionTools.appendChild(featureButton('Xem trước',()=>{
  preview.innerHTML='';preview.classList.toggle('hidden');
  for(const line of $('fDesc').value.split('\n')) {
    const p=featureEl('p');let rest=line;const pattern=/(\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;let match,last=0;
    while((match=pattern.exec(rest))){p.appendChild(document.createTextNode(rest.slice(last,match.index)));const node=featureEl(match[2]?'strong':match[3]?'em':'a',match[2] || match[3] || match[4]);if(node.tagName==='A'){node.href=match[5];node.target='_blank';node.rel='noopener noreferrer';}p.appendChild(node);last=pattern.lastIndex;}
    p.appendChild(document.createTextNode(rest.slice(last)));preview.appendChild(p);
  }
},'ghost'));
$('fDesc').before(descriptionTools);$('fDesc').after(preview);

// Start only after all workflow helpers have loaded.
init();
