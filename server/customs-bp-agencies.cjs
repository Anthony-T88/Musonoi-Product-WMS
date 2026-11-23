'use strict';

const B=require('./business-common.cjs');
const fields='id,project_id,name,version,archived_at';
const projectScope='EXISTS (SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=customs_bp_agencies.project_id)';

async function list(c,req,project){
 const {rows}=await c.query(`SELECT ${fields} FROM customs_bp_agencies
  WHERE ${projectScope} AND ($2::uuid IS NULL OR project_id=$2) AND archived_at IS NULL ORDER BY lower(name),id`,
 [req.user.id,project?B.uuid(project):null]);
 return rows;
}

async function book(c,req){
 const projects=(await c.query(`SELECT DISTINCT p.id,p.name FROM user_scopes s JOIN projects p ON p.id=s.project_id
  WHERE s.user_id=$1 ORDER BY p.name,p.id`,[req.user.id])).rows;
 return {projects,items:await list(c,req,req.query.project_id)};
}

async function resolve(c,req,project,id,version,lock){
 const record=(await c.query(`SELECT ${fields} FROM customs_bp_agencies
  WHERE ${projectScope} AND project_id=$2 AND id=$3 AND archived_at IS NULL${lock?' FOR SHARE':''}`,
 [req.user.id,project,B.uuid(id)])).rows[0];
 if(!record||record.version!==B.version(version))throw B.error(409,'BP_AGENCY_CHANGED');
 return {agency:record.name,agency_id:record.id};
}

async function change(c,req){
 const {project_id,name,version,...extra}=req.body||{};
 if(Object.keys(extra).length)throw B.error(400,'BP_INVALID_FIELD');
 const id=req.params.id?B.uuid(req.params.id):null,archiving=req.method==='DELETE';
 const value=archiving?null:B.text(name,'BP_AGENCY_NAME',1000);
 if(value&&/[\x00-\x1f]/.test(value))throw B.error(400,'BP_INVALID_FIELD');
 let prior,next;
 if(id){
  prior=(await c.query(`SELECT ${fields} FROM customs_bp_agencies
   WHERE ${projectScope} AND id=$2 AND archived_at IS NULL FOR UPDATE`,[req.user.id,id])).rows[0];
  if(!prior)throw B.error(404,'BP_AGENCY_NOT_FOUND');
  if(prior.version!==B.version(version))throw B.error(409,'BP_AGENCY_CHANGED');
 }else{
  const allowed=await c.query('SELECT 1 FROM user_scopes WHERE user_id=$1 AND project_id=$2',[req.user.id,B.uuid(project_id)]);
  if(!allowed.rowCount)throw B.error(403,'BP_AGENCY_PROJECT');
 }
 try{
  if(archiving){
   next=(await c.query(`UPDATE customs_bp_agencies SET archived_at=clock_timestamp(),version=version+1 WHERE id=$1 RETURNING ${fields}`,[id])).rows[0];
  }else if(id){
   next=(await c.query(`UPDATE customs_bp_agencies SET name=$2,version=version+1 WHERE id=$1 RETURNING ${fields}`,[id,value])).rows[0];
  }else{
   next=(await c.query(`INSERT INTO customs_bp_agencies (project_id,name,created_by) VALUES ($1,$2,$3) RETURNING ${fields}`,
    [project_id,value,req.user.id])).rows[0];
  }
 }catch(error){if(error.code==='23505')throw B.error(409,'BP_AGENCY_DUPLICATE');throw error;}
 await B.audit(c,req,'customs_bp_agency_'+({POST:'created',PATCH:'updated',DELETE:'archived'}[req.method]),
  'customs_bp_agencies',next.id,prior,next);
 return next;
}

module.exports={book,list,resolve,change};
