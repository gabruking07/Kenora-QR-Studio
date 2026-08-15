import jwt from 'jsonwebtoken';
export const auth=(req,res,next)=>{try{const token=req.headers.authorization?.split(' ')[1];if(!token)throw Error();req.user=jwt.verify(token,process.env.JWT_SECRET);next()}catch{res.status(401).json({success:false,message:'Authentication required'})}};
