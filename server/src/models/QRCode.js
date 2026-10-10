import mongoose from 'mongoose';
export default mongoose.model('QRCode', new mongoose.Schema({userId:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true},name:{type:String,required:true,trim:true},type:{type:String,required:true},payload:{type:mongoose.Schema.Types.Mixed,required:true},customization:{type:mongoose.Schema.Types.Mixed,default:{}},logo:String},{timestamps:true}));
